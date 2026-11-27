// 米游社源：匹配不到时间区间时不再用同公告其它代号兜底（审计 2.17）
jest.mock('./bannerSource', () => ({ fetchText: jest.fn() }))

const fetchText = require('./bannerSource').fetchText
const { fetchMihoyoBanners } = require('./mihoyoBanner')

const POOL = {
  retcode: 0,
  data: {
    list: [{
      title: '代号A',
      start_time: '2024-01-01 00:00:00',
      end_time: '2024-01-15 00:00:00',
      activity_url: 'https://bbs.mihoyo.com/article/12345'
    }]
  }
}

// 两个独立卡池标题行（各成一个 section）：
// 第一段名称能匹配代号A；第二段「无关池」匹配不上，且唯一代号已被第一段使用
const POST = {
  retcode: 0,
  data: {
    post: {
      post: {
        subject: '',
        content: [
          '<p>「代号A」祈愿</p>',
          '<p>限定5星角色「角色1」</p>',
          '<p>「无关池」祈愿</p>',
          '<p>限定5星角色「角色2」</p>'
        ].join('')
      }
    }
  }
}

beforeEach(() => {
  fetchText.mockReset()
  fetchText.mockImplementation(async (url) => {
    if (url.includes('gacha_pool')) return JSON.stringify(POOL)
    if (url.includes('getPostFull')) return JSON.stringify(POST)
    throw new Error('unexpected url ' + url)
  })
})

test('匹配不到时间区间的段落被跳过，不写入无关代号的时间', async () => {
  const result = await fetchMihoyoBanners('hkrpg')
  expect(fetchText).toHaveBeenCalled()
  // 只有第一段拿到了时间；第二段的 time 不应被填成代号A 的时间
  expect(result.banners).toHaveLength(1)
  expect(result.banners[0].start).toBe('2024-01-01 00:00:00')
  expect(result.warnings).toBeDefined()
  expect(result.warnings.join(' ')).toMatch(/未能匹配时间区间/)
})
