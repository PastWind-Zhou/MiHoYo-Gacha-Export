const config = require('./config')
const { getData } = require('./getData')
const { getLocalBanners } = require('./gachaBanner')
const { getGachaTypes } = require('./games')
const { buildWaiwaiStats } = require('./utils/waiwaiStats')

// 取当前游戏 / 指定游戏的歪率分析数据
const getWaiwaiStats = async (gameId) => {
  const game = gameId || config.game
  const { dataMap, current } = getData()
  const data = dataMap.get(current)
  const banners = await getLocalBanners(game)
  const types = getGachaTypes(game, config.lang)
  return buildWaiwaiStats({ game, result: data?.result, banners, types })
}

module.exports = { getWaiwaiStats }
