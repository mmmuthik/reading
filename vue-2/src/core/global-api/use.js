/* @flow */

import { toArray } from '../util/index'

export function initUse (Vue: GlobalAPI) {

  // use 方法接收一个函数或者对象
  Vue.use = function (plugin: Function | Object) {
    const installedPlugins = (this._installedPlugins || (this._installedPlugins = []))
    if (installedPlugins.indexOf(plugin) > -1) {
      return this
    }

    // additional parameters
    const args = toArray(arguments, 1)
    args.unshift(this)

    // 判断传入的玩意儿是 object
    // vue 就找有没有 install 属性
    if (typeof plugin.install === 'function') {
      // 如果 install 是个方法
      // 就直接执行
      plugin.install.apply(plugin, args)
    } else if (typeof plugin === 'function') {
      plugin.apply(null, args)
    }
    installedPlugins.push(plugin)
    return this
  }
}

/* __ReadMark__ */
