const config = require('./config')
const { getData } = require('./getData')
const { getLocalBanners } = require('./gachaBanner')
const { getGachaTypes } = require('./games')
const { buildWaiwaiStats } = require('./utils/waiwaiStats')

// 取当前游戏 / 指定游戏的歪率分析数据
const getWaiwaiStats = async (gameId) => {
  // 等配置加载完成：config.game / config.current 决定统计哪个游戏、哪个账号。
  // 未加载完时 current 会是别的游戏的 uid，导致统计结果为空。
  await config.ready
  const game = gameId || config.game
  try {
    const { dataMap, current } = getData()
    const data = dataMap.get(current)
    // getLocalBanners 返回的是 { source, updated, banners } 结构，
    // 判定引擎需要的是 banners 数组本身
    const bannerSet = await getLocalBanners(game)
    const banners = Array.isArray(bannerSet) ? bannerSet : (bannerSet?.banners || [])
    const types = getGachaTypes(game, config.lang)
    return buildWaiwaiStats({ game, result: data?.result, banners, types })
  } catch (e) {
    // 统计失败时返回空结构，避免影响界面
    console.error('get waiwai stats failed', e)
    return { game, pools: [] }
  }
}

module.exports = { getWaiwaiStats }
