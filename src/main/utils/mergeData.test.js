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
