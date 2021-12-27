/* @flow */

import type VueRouter from '../index'
import { parsePath, resolvePath } from './path'
import { resolveQuery } from './query'
import { fillParams } from './params'
import { warn } from './warn'
import { extend } from './misc'

export function normalizeLocation (
  raw: RawLocation,
  current: ?Route,
  append: ?boolean,
  router: ?VueRouter
): Location {
  let next: Location = typeof raw === 'string' ? { path: raw } : raw
  // named target 如果已经序列化，返回
  if (next._normalized) {
    return next
  } else if (next.name) {
    next = extend({}, raw)
    const params = next.params
    if (params && typeof params === 'object') {
      next.params = extend({}, params)
    }
    return next
  }

  // relative params 相对参数： 如果不传 next.path ， 并且传了params和当前路由
  if (!next.path && next.params && current) {
    next = extend({}, next)
    next._normalized = true
    const params: any = extend(extend({}, current.params), next.params)
    if (current.name) { // 如果当前路由name存在
      next.name = current.name// 当前路由 name赋值给 next
      next.params = params //  合并后的 params 赋值给next
    } else if (current.matched.length) { // 否则如果当前路由匹配的路由规则数组大于0
      const rawPath = current.matched[current.matched.length - 1].path// 获取数组末尾的 path，填充参数后赋值给 next.path
      next.path = fillParams(rawPath, params, `path ${current.path}`)// 得到用params填充替换后的path
    } else if (process.env.NODE_ENV !== 'production') { // 否则就给出警告 相对参数导航需要提供一个当前路由
      warn(false, `relative params navigation requires a current route.`)
    }
    return next
  }
  // 解析路由，返回 { path query hash }
  const parsedPath = parsePath(next.path || '')
  const basePath = (current && current.path) || '/'
  const path = parsedPath.path // 解析path获得绝对路径
    ? resolvePath(parsedPath.path, basePath, append || next.append)
    : basePath
  // 解析 query参数 得到字典对象
  const query = resolveQuery(
    parsedPath.query,
    next.query,
    router && router.options.parseQuery
  )
  // hash值
  let hash = next.hash || parsedPath.hash
  if (hash && hash.charAt(0) !== '#') {
    hash = `#${hash}`
  }

  return {
    _normalized: true,
    path,
    query,
    hash
  }
}
