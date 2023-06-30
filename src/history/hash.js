/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { getLocation } from './html5'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

export class HashHistory extends History {
  constructor (router: Router, base: ?string, fallback: boolean) {
    super(router, base)
    // check history fallback deeplinking
    if (fallback && checkFallback(this.base)) {
      return
    }
    ensureSlash()
  }

  // this is delayed until the app mounts
  // to avoid the hashchange listener being fired too early
  // 为了避免hashchange侦听器过早启动，这将延迟到应用程序挂载会后才初始化监听路由事件
  setupListeners () {
    if (this.listeners.length > 0) {
      return
    }

    const router = this.router
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll

    if (supportsScroll) {
      this.listeners.push(setupScroll())
    }
    // 监听路由变化的回调函数
    const handleRoutingEvent = () => {
      const current = this.current
      if (!ensureSlash()) {
        return
      }
      this.transitionTo(getHash(), route => {
        if (supportsScroll) {
          handleScroll(this.router, route, current, true)
        }
        //  路由过渡完成后，如果不支持 pushState事件，就执行replace替换当前历史记录.
        // 感觉这里没啥意义吧，路由完成后，又去替换当前路由地址？ hashchange 事件不会再次触发的，因为没变化。虽然popstate事件会触发但跳过了popstate模式
        if (!supportsPushState) {
          replaceHash(route.fullPath)
        }
      })
    }// 如果支持history模式，监听 popstate事件 否则监听 hashchange 事件
    const eventType = supportsPushState ? 'popstate' : 'hashchange'
    window.addEventListener(
      eventType,
      handleRoutingEvent
    )
    this.listeners.push(() => {
      window.removeEventListener(eventType, handleRoutingEvent)
    })
  }
  // 导航到新地址，过渡完成后向历史记录添加一条记录，然后执行滚动回调
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        pushHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }
  // 导航到新地址，过渡完成后替换；历史记录，然后执行滚动
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        replaceHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }

  go (n: number) {
    window.history.go(n)
  }
  // 确保 url ，   push为true时用push方法浏览器会新增一条记录，否则用 replace 替换记录
  ensureURL (push?: boolean) {
    const current = this.current.fullPath
    if (getHash() !== current) { // 如果当前路由的hash值跟fullPath不同，替换为当前路由
      push ? pushHash(current) : replaceHash(current)
    }
  }
  // 获取当前路由信息
  getCurrentLocation () {
    return getHash()
  }
}
// 检查回退,如果去掉base后当前路由不是 # 开头，repace当前路由为 base + '/#' + location
function checkFallback (base) {
  const location = getLocation(base)
  if (!/^\/#/.test(location)) {
    window.location.replace(cleanPath(base + '/#' + location))
    return true
  }
}

function ensureSlash (): boolean {
  const path = getHash()
  if (path.charAt(0) === '/') {
    return true
  }
  replaceHash('/' + path)
  return false
}
// 获取当前路由的hash值
export function getHash (): string {
  // We can't use window.location.hash here because it's not
  // consistent across browsers - Firefox will pre-decode it!
  let href = window.location.href
  const index = href.indexOf('#')
  // empty path
  if (index < 0) return ''

  href = href.slice(index + 1)
  // decode the hash but not the search or hash
  // as search(query) is already decoded
  // https://github.com/vuejs/vue-router/issues/2708
  const searchIndex = href.indexOf('?')
  if (searchIndex < 0) {
    const hashIndex = href.indexOf('#')
    if (hashIndex > -1) {
      href = decodeURI(href.slice(0, hashIndex)) + href.slice(hashIndex)
    } else href = decodeURI(href)
  } else {
    href = decodeURI(href.slice(0, searchIndex)) + href.slice(searchIndex)
  }

  return href
}
// 获取url, 就是拼接地址 http://xxx/xxx.html/# + path
function getUrl (path) {
  const href = window.location.href
  const i = href.indexOf('#')
  const base = i >= 0 ? href.slice(0, i) : href
  return `${base}#${path}`
}
// 推入一条历史记录，如果支持history模式调用 window.history.pushState ,否则重定向
function pushHash (path) {
  if (supportsPushState) {
    pushState(getUrl(path))
  } else {
    window.location.hash = path
  }
}
//  替换当前历史记录，如果支持history模式调用 window.history.pushState ,否则重定向
function replaceHash (path) {
  if (supportsPushState) {
    replaceState(getUrl(path))
  } else {
    window.location.replace(getUrl(path))
  }
}
