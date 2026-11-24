import * as IconComponents from '@element-plus/icons-vue'

const weaponTypeNames = new Set([
  '光锥', '光錐', 'Lichtkegel', 'Light Cone', 'Conos de luz', 'cônes de lumière', '光円錐', '광추', 'Cones de Luz', 'Световые конусы', 'Nón Ánh Sáng', 'Cône de lumière',
  '武器', 'Weapon', '무기', 'Arma', 'Arme', 'Оружие', 'อาวุธ', 'Vũ Khí', 'Waffe', 'Senjata',
  '音擎', 'W-Engines', 'W-Engine'
])

const characterTypeNames = new Set([
  '角色', 'Figur', 'Character', 'Personajes', 'Personnages', 'Karakter', 'キャラクター', '캐릭터', 'Personagens', 'Персонажи', 'ตัวละคร', 'Nhân Vật', 'Personnage',
  '代理人', 'Agents', 'Agent'
])

const bangbooTypeNames = new Set([
  '邦布', 'Bangboo'
])

const isCharacter = (name) => characterTypeNames.has(name)
const isWeapon = (name) => weaponTypeNames.has(name)
const isBangboo = (name) => bangbooTypeNames.has(name)

const IconInstaller = (app) => {
  Object.values(IconComponents).forEach(component => {
    app.component(component.name, component)
  })
}

export {
  isWeapon,
  isCharacter,
  isBangboo,
  IconInstaller,
}
