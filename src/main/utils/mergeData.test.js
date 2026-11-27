const { mergeList, mergeData } = require('./mergeData')

test('mergeList successed', () => {
  const listA = [{
    "id": "1682521800010412850",
  },
  {
    "id": "1682521800010412950",
  }]

  const listB = [{
    "id": "1682521800010412900",
  }]

  expect(mergeList(listA, listB)).toEqual([
    {
      "id": "1682521800010412850",
    },
    {
      "id": "1682521800010412900",
    },
    {
      "id": "1682521800010412950",
    }
  ])
})

test('mergeList with repeated data successed', () => {
  const listA = [{
    "id": "1682521800010412850",
  },
  {
    "id": "1682521800010412950",
  }]

  const listB = [{
    "id": "1682521800010412950",
  }]

  expect(mergeList(listA, listB)).toEqual([
    {
      "id": "1682521800010412850",
    },
    {
      "id": "1682521800010412950",
    }
  ])
})

test('mergeList empty successed', () => {
  const listA = []
  const listB = [{
    "id": "1682521800010412900",
  }]
  expect(mergeList(listA, listB)).toEqual([
    {
      "id": "1682521800010412900",
    }
  ])
})

test('mergeList empty 2 successed', () => {
  const listA = [{
    "id": "1682521800010412900",
  }]
  const listB = []
  expect(mergeList(listA, listB)).toEqual([
    {
      "id": "1682521800010412900",
    }
  ])
})

// 回归：v3.0 导入的记录没有 id，BigInt 转换会抛错导致整个导入失败
test('mergeList 记录无 id 时不抛错', () => {
  const listA = [{ time: '2024-01-05 12:00:00', name: '刻晴' }]
  const listB = []
  expect(() => mergeList(listA, listB)).not.toThrow()
  expect(mergeList(listA, listB)).toHaveLength(1)
})

// 回归：脏 id（非纯数字）同样不能抛错
test('mergeList 脏 id 时不抛错', () => {
  const listA = [{ id: 'abc', time: '2024-01-05 12:00:00' }]
  const listB = [{ id: '123' }]
  expect(() => mergeList(listA, listB)).not.toThrow()
  expect(mergeList(listA, listB)).toHaveLength(2)
})

// 回归：去重方向曾反置，丢弃了带 id 的新记录、留下无 id 的空壳
test('mergeList 同内容优先保留带 id 的记录', () => {
  const legacy = { time: '2024-01-05 12:00:00', name: '刻晴', item_type: '角色' }
  const withId = { id: '1682521800010412850', time: '2024-01-05 12:00:00', name: '刻晴', item_type: '角色' }
  const merged = mergeList([legacy], [withId])
  expect(merged).toHaveLength(1)
  expect(merged[0].id).toBe('1682521800010412850')
})

// 回归：本地独有的池被静默丢弃
test('mergeData 保留本地独有的池', () => {
  const local = {
    uid: 1,
    result: new Map([
      ['301', [{ id: '1' }]],
      ['999', [{ id: '2' }]]
    ])
  }
  const origin = {
    uid: 1,
    result: new Map([
      ['301', [{ id: '3' }]]
    ])
  }
  const merged = mergeData(local, origin)
  expect(merged.has('301')).toBe(true)
  expect(merged.has('999')).toBe(true)
  expect(merged.get('999')).toEqual([{ id: '2' }])
})

// 回归：旧 JSON 的 uid 是数字、抓取接口返回字符串时，
// !== 会把同一账号判成两个 uid，直接返回 origin.result 丢掉本地记录
test('mergeData 归一 uid 类型，数字 local 与字符串 origin 视为同一账号', () => {
  const local = {
    uid: 123456,
    result: new Map([['1000', [{ id: '1', name: '本地' }]]])
  }
  const origin = {
    uid: '123456',
    result: new Map([['1000', [{ id: '2', name: '远程' }]]])
  }
  const merged = mergeData(local, origin)
  expect(merged.get('1000').map(item => item.id).sort()).toEqual(['1', '2'])
})

// 反向：字符串 local 与数字 origin 同样合并，且保留双方记录
test('mergeData 归一 uid 类型，字符串 local 与数字 origin 视为同一账号', () => {
  const local = {
    uid: '123456',
    result: new Map([['1000', [{ id: '1', name: '本地' }]]])
  }
  const origin = {
    uid: 123456,
    result: new Map([['1000', [{ id: '2', name: '远程' }]]])
  }
  const merged = mergeData(local, origin)
  expect(merged.get('1000').map(item => item.id).sort()).toEqual(['1', '2'])
})

// 合并方向：uid 确实不同时仍只取 origin，不能把别的账号混进来
test('mergeData 对不同 uid 仍只保留 origin 数据', () => {
  const local = {
    uid: 123456,
    result: new Map([['1000', [{ id: '1', name: '本地' }]]])
  }
  const origin = {
    uid: '654321',
    result: new Map([['1000', [{ id: '2', name: '远程' }]]])
  }
  const merged = mergeData(local, origin)
  expect(merged).toBe(origin.result)
  expect(merged.get('1000')).toEqual([{ id: '2', name: '远程' }])
})
