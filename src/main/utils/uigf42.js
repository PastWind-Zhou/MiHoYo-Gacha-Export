// UIGF v4.2 纯转换逻辑（不依赖 Electron，便于单元测试）
// 官方 Schema：src/main/uigf-schema.json（取自 https://uigf.org/zh/standards/uigf.html）
const path = require('path')
const schema = require('../uigf-schema.json')
const { games } = require('../games')

const UIGF_VERSION = 'v4.2'
const V4_VERSION_RE = /^v4\.\d+$/
const INFO_VERSION_RE = /^v\d+\.\d+$/

// 原神：400 与 301 共用保底，UIGF 规定统一记为 301
const GENSHIN_UIGF_TYPE = {
  '100': '100',
  '200': '200',
  '301': '301',
  '400': '301',
  '302': '302',
  '500': '500'
}

// UIGF v4.2 规定 uigf_gacha_type 的取值范围（仅原神使用该字段）
const UIGF_GACHA_TYPES = ['100', '200', '301', '302', '500']

// 原神千星奇域（hk4e_ugc）卡池类型，与 games.js / UIGF v4.2 Schema 保持一致
const UGC_TYPES = games.genshin.ugcPools

const isUGCType = (type) => UGC_TYPES.includes(String(type))

const hk4eListSchema = schema.properties.hk4e.items.properties.list.items
const hkrpgListSchema = schema.properties.hkrpg.items.properties.list.items
const napListSchema = schema.properties.nap.items.properties.list.items
// hk4e_ugc 的账号字段在 items 下（数组元素），旧 schema 误挂在数组本身上导致校验形同虚设
const ugcListSchema = schema.properties.hk4e_ugc.items.properties.list.items
const TIME_RE = new RegExp(hk4eListSchema.properties.time.pattern)
const ID_RE = new RegExp(hk4eListSchema.properties.id.pattern)

// 合法 uid：6-12 位纯数字。UIGF 导入的 uid 会直接拼进本地文件名
// （gacha-list-<uid>.json / ugc-list-<uid>.json），形如 x/../../evil 的
// 非法值经 path.join 归一化后会逃出游戏目录，必须在这里统一拦截
const UID_RE = /^\d{6,12}$/
const isSupportedV4Version = (version) => typeof version === 'string' && V4_VERSION_RE.test(version)

const isValidUid = (uid) => {
  if (uid === null || uid === undefined) return false
  return UID_RE.test(String(uid).trim())
}

// 落盘前的第二道防线：目标路径必须仍在 base 目录内。
// uid 已过正则校验，这里防御的是后续代码变更引入的新穿越方式
const isInsideDir = (base, target) => {
  const rel = path.relative(path.resolve(base), path.resolve(target))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// timezone 归一：null / undefined / 空串经 Number() 都会得到 0（伦敦时区），
// 但它们真实的语义是「缺失」而非 0；超范围值同样按缺失处理，统一回退默认 +8
const isValidTimezone = (value) => {
  if (value === null || value === undefined || value === '') return false
  const num = Number(value)
  return Number.isFinite(num) && num >= -12 && num <= 14
}

const normalizeTimezone = (value, fallback = 8) => {
  return isValidTimezone(value) ? Number(value) : fallback
}

// 原神 v4.1 导出规则：UID 前缀 6(美服) -5、7(欧服) 1、其余 8
// 千星奇域账号没有 region_time_zone，时区同样按 UID 前缀推导
const uidTimeZone = (uid) => {
  const s = `${uid}`
  if (s.startsWith('6')) return -5
  if (s.startsWith('7')) return 1
  return 8
}

const makeInfo = ({ appName, appVersion, timestamp = Math.ceil(Date.now() / 1000) }) => ({
  export_timestamp: timestamp,
  export_app: appName,
  export_app_version: appVersion,
  version: UIGF_VERSION
})

const uigfGachaTypeOf = (gameId, gachaType) => {
  if (gameId !== 'genshin') return ''
  const type = String(gachaType ?? '')
  return GENSHIN_UIGF_TYPE[type] || type
}

// 记录 id 可能是脏数据（非纯数字），排序时容错按 0 处理，避免导出直接抛错
const toBigInt = (value) => {
  try {
    return BigInt(String(value ?? '').trim() || '0')
  } catch (e) {
    return 0n
  }
}

const sortByRecordId = (a, b) => {
  const av = toBigInt(a.id)
  const bv = toBigInt(b.id)
  return av > bv ? 1 : av < bv ? -1 : 0
}

// 本地记录 → UIGF list 项
const toUIGFRecord = ({ gameId, log, itemId = '' }) => {
  const rec = {
    gacha_id: String(log.gacha_id ?? ''),
    gacha_type: String(log.gacha_type ?? ''),
    item_id: String(log.item_id || itemId || ''),
    count: String(log.count ?? '1'),
    time: String(log.time ?? ''),
    name: String(log.name ?? ''),
    item_type: String(log.item_type ?? ''),
    rank_type: String(log.rank_type ?? ''),
    id: String(log.id ?? '')
  }
  if (gameId === 'genshin') {
    rec.uigf_gacha_type = uigfGachaTypeOf(gameId, rec.gacha_type)
  }
  return rec
}

// UIGF list 项 → 本地记录；按 uigf_gacha_type 分组后再落盘
//
// allowedUigfTypes：允许作为分组键的 uigf_gacha_type 取值白名单。
//   - 原神：['100','200','301','302','500']（400 与 301 共用保底，UIGF 归一为 301）
//   - 其他游戏：[] —— UIGF 只为原神定义了该字段，别人的脏数据不应改变本地分池
// 白名单之外的取值一律回退到 gacha_type，避免记录被分到不存在的池。
const groupUIGFRecords = (records, options = {}) => {
  const allowed = options.allowedUigfTypes || []
  // null 原型对象：分组键来自导入数据，__proto__/constructor 这类键
  // 在普通对象上会命中原型成员而非自有属性，造成分组错乱甚至污染
  const grouped = Object.create(null)
  records.forEach(rec => {
    const uigfType = String(rec.uigf_gacha_type ?? '')
    const key = (uigfType && allowed.includes(uigfType)) ? uigfType : String(rec.gacha_type ?? '')
    const clean = { ...rec }
    delete clean.uigf_gacha_type
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(clean)
  })
  return grouped
}

// 千星奇域账号：只用 UIGF v4.2 规定的字段，丢弃未知卡池类型；
// uid 非法（路径穿越形态）时整个账号丢弃，返回 null 由调用方跳过
const normalizeUGCAccount = (account) => {
  if (!account || account.uid === undefined || account.uid === null) return null
  if (!isValidUid(account.uid)) return null
  const source = Array.isArray(account.list) ? account.list : []
  const list = source
    .map(record => ({
      id: String(record?.id ?? ''),
      schedule_id: String(record?.schedule_id ?? ''),
      item_type: String(record?.item_type ?? ''),
      item_id: String(record?.item_id ?? ''),
      item_name: String(record?.item_name ?? record?.name ?? ''),
      rank_type: String(record?.rank_type ?? ''),
      time: String(record?.time ?? ''),
      // 接口 getBeyondGachaLog 用 gacha_type 传参，返回记录可能也用 gacha_type，
      // 而 UIGF v4.2 落盘字段是 op_gacha_type；优先取标准字段，缺省时回退，避免抓取记录被全量过滤
      op_gacha_type: String(record?.op_gacha_type ?? record?.gacha_type ?? '')
    }))
    .filter(record => record.id && record.schedule_id && record.item_id && record.time && isUGCType(record.op_gacha_type))
    .sort(sortByRecordId)
  return {
    uid: String(account.uid).trim(),
    // timezone 缺失 / null / 空串 / 超范围都回退到默认 +8：
    // Number(null) 与 Number('') 都是 0 且 finite，直接 Number 会得到 0 时区（伦敦）
    timezone: normalizeTimezone(account.timezone, 8),
    lang: String(account.lang || 'zh-cn'),
    list
  }
}

// 依据内置 Schema 做轻量校验，返回警告数组（不抛异常、不阻塞导出）
const validateUIGF42 = (json) => {
  const warnings = []
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['根节点必须是对象']

  const info = json.info
  if (!info || typeof info !== 'object') {
    warnings.push('缺少 info 对象')
  } else {
    if (!INFO_VERSION_RE.test(String(info.version ?? ''))) {
      warnings.push('info.version 格式不合法')
    } else if (info.version !== UIGF_VERSION) {
      warnings.push(`info.version=${info.version}，当前工具导出版本为 ${UIGF_VERSION}`)
    }
    ;['export_timestamp', 'export_app', 'export_app_version'].forEach(key => {
      if (info[key] === undefined || info[key] === null) warnings.push(`info.${key} 缺失`)
    })
  }

  const checkList = (records, key, index, recordSchema) => {
    const props = recordSchema.properties || {}
    const required = recordSchema.required || []
    records.forEach((rec, j) => {
      const at = `${key}[${index}].list[${j}]`
      required.forEach(field => {
        if (rec[field] === undefined || rec[field] === null || rec[field] === '') warnings.push(`${at} 缺少 ${field}`)
      })
      if (props.time && !TIME_RE.test(String(rec.time ?? ''))) warnings.push(`${at} time 格式不合法`)
      if (props.id && (!ID_RE.test(String(rec.id ?? '')) || String(rec.id).length > 19)) warnings.push(`${at} id 不合法`)
      if (props.gacha_type?.enum && !props.gacha_type.enum.includes(String(rec.gacha_type ?? ''))) {
        warnings.push(`${at} gacha_type=${rec.gacha_type} 不在 Schema 枚举内`)
      }
      if (props.uigf_gacha_type?.enum && !props.uigf_gacha_type.enum.includes(String(rec.uigf_gacha_type ?? ''))) {
        warnings.push(`${at} uigf_gacha_type=${rec.uigf_gacha_type} 不在 Schema 枚举内`)
      }
      if (props.op_gacha_type?.enum && !props.op_gacha_type.enum.includes(String(rec.op_gacha_type ?? ''))) {
        warnings.push(`${at} op_gacha_type=${rec.op_gacha_type} 不在 Schema 枚举内`)
      }
      ;['item_id', 'schedule_id', 'rank_type'].forEach(field => {
        if (props[field]?.pattern && String(rec[field] ?? '') && !new RegExp(props[field].pattern).test(String(rec[field]))) {
          warnings.push(`${at} ${field} 格式不合法`)
        }
      })
    })
  }

  ;[
    ['hk4e', hk4eListSchema],
    ['hkrpg', hkrpgListSchema],
    ['nap', napListSchema],
    ['hk4e_ugc', ugcListSchema]
  ].forEach(([key, recordSchema]) => {
    if (!(key in json)) return
    if (!Array.isArray(json[key])) {
      warnings.push(`${key} 必须是数组`)
      return
    }
    json[key].forEach((account, index) => {
      if (account.uid === undefined || account.uid === null) warnings.push(`${key}[${index}].uid 缺失`)
      // timezone 严格校验：null/空串经 Number() 会伪装成合法的 0，
      // 不报警会让下游把整份档案按 0 时区解释（审计 2.12/2.18 的同一类根因）
      if (!isValidTimezone(account.timezone)) warnings.push(`${key}[${index}].timezone 非法（缺失、非数字或超出 [-12, 14]）`)
      if (!Array.isArray(account.list)) {
        warnings.push(`${key}[${index}].list 必须是数组`)
        return
      }
      checkList(account.list, key, index, recordSchema)
    })
  })

  return warnings
}

module.exports = {
  UIGF_VERSION,
  UGC_TYPES,
  UIGF_GACHA_TYPES,
  schema,
  isUGCType,
  isSupportedV4Version,
  isValidUid,
  isInsideDir,
  isValidTimezone,
  normalizeTimezone,
  uidTimeZone,
  makeInfo,
  uigfGachaTypeOf,
  sortByRecordId,
  toUIGFRecord,
  groupUIGFRecords,
  normalizeUGCAccount,
  validateUIGF42
}
