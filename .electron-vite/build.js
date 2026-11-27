'use strict'
process.env.NODE_ENV = 'production'

const { say } = require('cfonts')
const { sync } = require('del')
const fs = require('fs-extra')
const path = require('path')

const chalk = require('chalk')
const rollup = require("rollup")
const { build } = require('vite')
const Multispinner = require('multispinner')

const mainOptions = require('./rollup.main.config');
const rendererOptions = require('./vite.config')
const opt = mainOptions(process.env.NODE_ENV);

const doneLog = chalk.bgGreen.white(' DONE ') + ' '
const errorLog = chalk.bgRed.white(' ERROR ') + ' '
const okayLog = chalk.bgBlue.white(' OKAY ') + ' '
const isCI = process.env.CI || false

if (process.env.BUILD_TARGET === 'web') web()
else unionBuild()

function clean() {
    // 注意：build/ 下可能有 <productName>-<version>/userData —— 那是用户的抽卡记录，
    // 清理时绝不能删。实测 del v6 的否定模式（!build/*/userData）只能把子目录
    // 从匹配结果中排除，挡不住父目录（build/* 命中的版本目录）被整体递归删除。
    // 因此对 build/ 改用显式遍历：保留 icons/lib 与任何目录下的 userData，
    // 其余构建产物逐项删除。
    sync([
        'dist/electron/main/*',
        'dist/electron/renderer/*',
        'dist/web/*',
    ])
    cleanBuildDir()
    console.log(`\n${doneLog}clear done`)
    if (process.env.BUILD_TARGET === 'onlyClean') process.exit()
}

// 显式清理 build/：保留 icons、lib，其余条目逐个处理（见 cleanEntry）
function cleanBuildDir() {
    const buildDir = path.resolve('build')
    if (!fs.existsSync(buildDir)) return
    for (const name of fs.readdirSync(buildDir)) {
        if (name === 'icons' || name === 'lib') continue
        cleanEntry(path.join(buildDir, name))
    }
}

// 删除一个文件或目录；目录内含 userData 时只删 userData 之外的兄弟项，
// 版本目录本身与 userData 原地保留（用户数据始终在 exe 同级目录下）
function cleanEntry(target) {
    let st
    try {
        st = fs.lstatSync(target)
    } catch (e) {
        return
    }
    if (!st.isDirectory()) {
        fs.removeSync(target)
        return
    }
    if (!fs.existsSync(path.join(target, 'userData'))) {
        fs.removeSync(target)
        return
    }
    for (const name of fs.readdirSync(target)) {
        if (name === 'userData') continue
        fs.removeSync(path.join(target, name))
    }
}

function unionBuild() {
    greeting()
    if (process.env.BUILD_TARGET === 'clean' || process.env.BUILD_TARGET === 'onlyClean') clean()

    const tasks = ['main', 'renderer']
    const m = new Multispinner(tasks, {
        preText: 'building',
        postText: 'process'
    })
    let results = ''

    m.on('success', () => {
        process.stdout.write('\x1B[2J\x1B[0f')
        console.log(`\n\n${results}`)
        console.log(`${okayLog}take it away ${chalk.yellow('`electron-builder`')}\n`)
        process.exit()
    })

    rollup.rollup(opt)
        .then(build => {
            results += `${doneLog}MainProcess build success` + '\n\n'
            // write 失败也要捕获，否则 spinner 会一直挂着等不到 success/error
            build.write(opt.output).then(() => {
                m.success('main')
            }).catch(error => {
                m.error('main')
                console.log(`\n  ${errorLog}failed to write main process bundle`)
                console.error(`\n${error}\n`)
                process.exit(1)
            })
        })
        .catch(error => {
            m.error('main')
            console.log(`\n  ${errorLog}failed to build main process`)
            console.error(`\n${error}\n`)
            process.exit(1)
        });

    build(rendererOptions).then(res => {
        results += `${doneLog}RendererProcess build success` + '\n\n'
        copyI18n()
        m.success('renderer')
    }).catch(err => {
        m.error('renderer')
        console.log(`\n  ${errorLog}failed to build renderer process`)
        console.error(`\n${err}\n`)
        process.exit(1)
    })
}

// i18n 按游戏分目录在运行时读取，需要随主进程一起复制到 dist
function copyI18n() {
    try {
        // 先清空目标目录：否则 src/i18n 中删除的语言文件会残留在 dist 里，
        // 并被打进发布包（build-main-only / build-renderer-only 都是先清空再复制）
        fs.emptyDirSync(path.resolve('dist/electron/i18n'))
        fs.copySync(path.resolve('src/i18n'), path.resolve('dist/electron/i18n'))
        console.log(`${okayLog}i18n copied to dist/electron/i18n`)
    } catch (e) {
        console.error(`${errorLog}failed to copy i18n: ${e}`)
    }
}

function web() {
    sync(['dist/web/*', '!.gitkeep'])
    build(rendererOptions).then(res => {
        console.log(`${doneLog}RendererProcess build success`)
        process.exit()
    })
}

function greeting() {
    const cols = process.stdout.columns
    let text = ''

    if (cols > 85) text = `let's-build`
    else if (cols > 60) text = `let's-|build`
    else text = false

    if (text && !isCI) {
        say(text, {
            colors: ['yellow'],
            font: 'simple3d',
            space: false
        })
    } else console.log(chalk.yellow.bold(`\n  let's-build`))
    console.log()
}