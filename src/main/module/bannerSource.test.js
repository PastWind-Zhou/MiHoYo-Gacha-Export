const { sourceLabel } = require('./bannerSource')

describe('数据源显示名（用户可见文案）', () => {
  test('内置源标识统一显示为「上游」', () => {
    expect(sourceLabel('hoyo-gacha')).toBe('上游')
    expect(sourceLabel('biligame-wiki')).toBe('上游')
    expect(sourceLabel('mihoyo-wiki')).toBe('上游')
  })

  test('带 fallback 后缀的内置源同样显示为「上游」', () => {
    expect(sourceLabel('hoyo-gacha(fallback)')).toBe('上游')
    expect(sourceLabel('biligame-wiki(fallback)')).toBe('上游')
  })

  test('空值显示为「上游」', () => {
    expect(sourceLabel('')).toBe('上游')
    expect(sourceLabel(null)).toBe('上游')
    expect(sourceLabel(undefined)).toBe('上游')
  })

  test('用户自己填写的自定义地址原样显示', () => {
    const url = 'https://example.com/banners.json'
    expect(sourceLabel(url)).toBe(url)
    expect(sourceLabel('http://127.0.0.1:8080/banners.json')).toBe('http://127.0.0.1:8080/banners.json')
  })

  test('多源依次失败时用序号区分（保留排查所需信息）', () => {
    expect(sourceLabel('hoyo-gacha', 0)).toBe('上游1')
    expect(sourceLabel('biligame-wiki', 1)).toBe('上游2')
    expect(sourceLabel('mihoyo-wiki', 2)).toBe('上游3')
  })

  test('自定义地址即使带序号也不加前缀', () => {
    expect(sourceLabel('https://example.com/a.json', 0)).toBe('https://example.com/a.json')
  })

  test('提示语中不出现技术标识', () => {
    const from = 'hoyo-gacha'
    const msg = `本地卡池数据与${sourceLabel(from)}完全一致（共 236 期），无需更新`
    expect(msg).toBe('本地卡池数据与上游完全一致（共 236 期），无需更新')
    expect(msg).not.toContain('hoyo-gacha')
  })
})
