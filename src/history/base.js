/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'
import {
  createNavigationDuplicatedError,
  createNavigationCancelledError,
  createNavigationRedirectedError,
  createNavigationAbortedError,
  isError,
  isNavigationFailure,
  NavigationFailureType
} from '../util/errors'

export class History {
  router: Router
  base: string
  current: Route
  pending: ?Route
  cb: (r: Route) => void
  ready: boolean
  readyCbs: Array<Function>
  readyErrorCbs: Array<Function>
  errorCbs: Array<Function>
  listeners: Array<Function>
  cleanupListeners: Function

  // implemented by sub-classes
  +go: (n: number) => void
  +push: (loc: RawLocation, onComplete?: Function, onAbort?: Function) => void
  +replace: (
    loc: RawLocation,
    onComplete?: Function,
    onAbort?: Function
  ) => void
  +ensureURL: (push?: boolean) => void
  +getCurrentLocation: () => string
  +setupListeners: Function

  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
    this.listeners = []
  }

  listen (cb: Function) {
    this.cb = cb
  }
  // 监听 ready 事件，推入 readyCbs 数组
  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }
  //  监听 error 事件
  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }
  // 过渡到下一个路由
  transitionTo (
    location: RawLocation,
    onComplete?: Function, // 路由导航完成回调
    onAbort?: Function // 路由导航被中断回调
  ) {
    let route
    // catch redirect option https://github.com/vuejs/vue-router/issues/3201 捕获重定向选项
    try { // 匹配路由 location
      route = this.router.match(location, this.current)
    } catch (e) {
      this.errorCbs.forEach(cb => {
        cb(e)
      })
      // Exception should still be thrown
      throw e
    } // 确认过渡到路由 route
    this.confirmTransition(
      route,
      () => { // 过渡成功回调
        const prev = this.current // 缓存当前路由
        this.updateRoute(route)// 更新路由对象 this.current = route
        onComplete && onComplete(route) // 完成回调
        this.ensureURL()// 确保修正url
        this.router.afterHooks.forEach(hook => { // 执行全局的导航完成回调
          hook && hook(route, prev)  // 参数既是 to, from
        })

        // fire ready cbs once  调用首次的 ready 钩子
        if (!this.ready) {
          this.ready = true
          this.readyCbs.forEach(cb => {
            cb(route)
          })
        }
      }, // 过渡失败回调
      err => {
        if (onAbort) {
          onAbort(err)
        }
        if (err && !this.ready) {
          this.ready = true
          // Initial redirection should still trigger the onReady onSuccess
          // https://github.com/vuejs/vue-router/issues/3225
          if (!isNavigationFailure(err, NavigationFailureType.redirected)) {
            this.readyErrorCbs.forEach(cb => {
              cb(err)
            })
          } else {
            this.readyCbs.forEach(cb => {
              cb(route)
            })
          }
        }
      }
    )
  }
  // 确认过渡路由 route, onAbort 接 transitionTo 的第三个参数. push或replace不传第三个参数时onAbort是promise的reject函数，会在控制台抛出错误
  confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {
    const current = this.current
    const abort = err => { // 中止回调
      // changed after adding errors with
      // https://github.com/vuejs/vue-router/pull/3047 before that change,
      // redirect and aborted navigation would produce an err == null
      if (!isNavigationFailure(err) && isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => {
            cb(err)
          })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    const lastRouteIndex = route.matched.length - 1
    const lastCurrentIndex = current.matched.length - 1
    if (// 如果要过渡的路由和当前路由相同，并且 最后一个下标值相同，并且最后一个路由记录也相同， 中止导航，并执行 error回调
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      lastRouteIndex === lastCurrentIndex &&
      route.matched[lastRouteIndex] === current.matched[lastCurrentIndex]
    ) {
      this.ensureURL()
      return abort(createNavigationDuplicatedError(current, route))
    }
    // 解决队列，当前路由匹配的记录，和新的导航匹配的记录 转换为 updated, deactivated, activated 为需要执行对应事件的记录
    const { updated, deactivated, activated } = resolveQueue(
      this.current.matched,
      route.matched
    )
    // 按照导航解析流程的待执行钩子队列
    const queue: Array<?NavigationGuard> = [].concat(
      // in-component leave guards 组件内置的leave守卫
      extractLeaveGuards(deactivated),
      // global before hooks  全局before守卫
      this.router.beforeHooks,
      // in-component update hooks 组件内置的update钩子
      extractUpdateHooks(updated),
      // in-config enter guards 路由配置上定义的 beforeEnter 守卫
      activated.map(m => m.beforeEnter),
      // async components  解决异步组件
      resolveAsyncComponents(activated)
    )
    // 缓存等待解决的路由对象
    this.pending = route
    const iterator = (hook: NavigationGuard, next) => {
      if (this.pending !== route) { // 退出并中止导航
        return abort(createNavigationCancelledError(current, route))
      }
      try {
        // 三个参数对应：to,from,next
        hook(route, current, (to: any) => {
          if (to === false) {
            // next(false) -> abort navigation, ensure current URL 中止导航
            this.ensureURL(true)
            abort(createNavigationAbortedError(current, route))
          } else if (isError(to)) {
            this.ensureURL(true)
            abort(to)
          } else if (// 如果是字符串或传入path,name，中止当前导航，并导航到新的地址
            typeof to === 'string' ||
            (typeof to === 'object' &&
              (typeof to.path === 'string' || typeof to.name === 'string'))
          ) {
            // next('/') or next({ path: '/' }) -> redirect
            abort(createNavigationRedirectedError(current, route))
            if (typeof to === 'object' && to.replace) {
              this.replace(to)
            } else {
              this.push(to)
            }
          } else {
            // confirm transition and pass on the value 确认转换并传入值,迭代到队列的下一个守卫
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }
    // 执行队列：  遍历queue执行iterator函数，迭代完成后再调用第三个参数函数
    runQueue(queue, iterator, () => {
      const postEnterCbs = []
      const isValid = () => this.current === route
      // wait until async components are resolved before  在解决异步组件之前请等待
      // extracting in-component enter guards   抽取组件内置的 enter 守卫
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
      const queue = enterGuards.concat(this.router.resolveHooks)  // 合并全局的 beforeResolve 守卫(全局解析钩子)
      // 队列执行完成后，迭代新的队列包含： 组件内置的 enter 守卫和全局的 beforeResolve 守卫。
      runQueue(queue, iterator, () => {
        if (this.pending !== route) {
          return abort(createNavigationCancelledError(current, route))
        }
        this.pending = null // 重置 pending
        onComplete(route)// 执行完成回调
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            postEnterCbs.forEach(cb => {
              cb()
            })
          })
        }
      })
    })
  }
  // 更新路由时，执行 cb回调
  updateRoute (route: Route) {
    this.current = route
    this.cb && this.cb(route)
  }
  // 初始化监听的默认实现是空的
  setupListeners () {
    // Default implementation is empty
  }
  // 清除所有监听
  teardownListeners () {
    this.listeners.forEach(cleanupListener => {
      cleanupListener()
    })
    this.listeners = []
  }
}
// 序列化base路径
function normalizeBase (base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  return base.replace(/\/$/, '')
}
// 解决待执行钩子的路由记录队列
function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i),
    activated: next.slice(i),
    deactivated: current.slice(i)
  }
}
// 提取导航守卫  这里应该是抽取的组件级导航守卫
function extractGuards (
  records: Array<RouteRecord>, // 路由记录数组
  name: string, // 守卫钩子名称
  bind: Function, // 绑定回调
  reverse?: boolean // 是否反转队列
): Array<?Function> {
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    const guard = extractGuard(def, name)
    if (guard) { // 如果钩子函数存在
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  return flatten(reverse ? guards.reverse() : guards)
}
// 提取组件构造函数上的钩子函数
function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}
// 提取并绑定 beforeRouteLeave 钩子
function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}
//  提取并绑定 beforeRouteUpdate 钩子
function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}
// 如果实例存在，返回一个包装函数，绑定实例为上下文执行导航守卫；
function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}
// 提取并绑定 beforeRouteEnter 钩子
function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(
    activated,
    'beforeRouteEnter',
    (guard, _, match, key) => {
      return bindEnterGuard(guard, match, key, cbs, isValid)
    }
  )
}

function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>,
  isValid: () => boolean
): NavigationGuard {
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      if (typeof cb === 'function') {
        cbs.push(() => {
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          // 如果是router-view组件包装的并且out-in过渡，这个实例现在可能还没有被注册，我们将需要轮询注册直到当前路由不再有效
          poll(cb, match.instances, key, isValid)
        })
      }
      next(cb)
    })
  }
}
// 如果实例存在调用回调， 否则轮询，延迟16毫秒
function poll (
  cb: any, // somehow flow cannot infer this is a function 不知何故，flow无法推断这是一个函数
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (
    instances[key] &&
    !instances[key]._isBeingDestroyed // do not reuse being destroyed instance 不要重用正在销毁的实例
  ) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
