const config = require('./config')
const { getData } = require('./getData')
const { getLocalBanners } = require('./gachaBanner')
const { getGachaTypes } = require('./games')
const { buildWaiwaiStats } = require('./utils/waiwaiStats')

// 取当前游戏 / 指定游戏的歪率分析数据
const getWaiwaiStats = async (gameId) => {
  const game = gameId || config.game
  try {
    const { dataMap, current } = getData()
    const data = dataMap.get(current)
    const banners = await getLocalBanners(game)
    const types = getGachaTypes(game, config.lang)
    return buildWaiwaiStats({ game, result: data?.result, banners, types })
  } catch (e) {
    // 统计失败时返回空结构，避免影响界面
    console.error('get waiwai stats failed', e)
    return { game, pools: [] }
  }
}

module.exports = { getWaiwaiStats }
