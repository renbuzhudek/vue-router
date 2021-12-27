/* @flow */

import Regexp from 'path-to-regexp'
import { cleanPath } from './util/path'
import { assert, warn } from './util/warn'

export function createRouteMap (
  routes: Array<RouteConfig>,
  oldPathList?: Array<string>,
  oldPathMap?: Dictionary<RouteRecord>, // 路由记录字典，key是path
  oldNameMap?: Dictionary<RouteRecord>// 路由记录字典，key是 route.name
): {
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>
} {
  // the path list is used to control path matching priority
  const pathList: Array<string> = oldPathList || []
  // $flow-disable-line
  const pathMap: Dictionary<RouteRecord> = oldPathMap || Object.create(null)
  // $flow-disable-line
  const nameMap: Dictionary<RouteRecord> = oldNameMap || Object.create(null)
  // 遍历添加路由记录
  routes.forEach(route => {
    addRouteRecord(pathList, pathMap, nameMap, route)
  })

  // ensure wildcard routes are always at the end 确保通配符路由始终位于末尾
  for (let i = 0, l = pathList.length; i < l; i++) {
    if (pathList[i] === '*') {
      pathList.push(pathList.splice(i, 1)[0])
      l--
      i--
    }
  }

  if (process.env.NODE_ENV === 'development') {
    // warn if routes do not include leading slashes
    const found = pathList
    // check for missing leading slash
      .filter(path => path && path.charAt(0) !== '*' && path.charAt(0) !== '/')

    if (found.length > 0) {
      const pathNames = found.map(path => `- ${path}`).join('\n')
      warn(false, `Non-nested routes must include a leading slash character. Fix the following routes: \n${pathNames}`)
    }
  }

  return {
    pathList,
    pathMap,
    nameMap
  }
}
// 添加路由记录，route
function addRouteRecord (
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>,
  route: RouteConfig,
  parent?: RouteRecord,
  matchAs?: string
) {
  const { path, name } = route
  if (process.env.NODE_ENV !== 'production') {
    assert(path != null, `"path" is required in a route configuration.`)
    assert(
      typeof route.component !== 'string',
      `route config "component" for path: ${String(
        path || name
      )} cannot be a ` + `string id. Use an actual component instead.`
    )
  }
  // route配置：编译路由正则表达式的选项
  const pathToRegexpOptions: PathToRegexpOptions =
    route.pathToRegexpOptions || {}
  const normalizedPath = normalizePath(path, parent, pathToRegexpOptions.strict)// 序列化path,得到父path拼接而成的path
  // route配置：是否区分大小写
  if (typeof route.caseSensitive === 'boolean') {
    pathToRegexpOptions.sensitive = route.caseSensitive
  }
  // 构造路由记录对象
  const record: RouteRecord = {
    path: normalizedPath, // 序列化后的 path，也就是拼接了父 path
    regex: compileRouteRegex(normalizedPath, pathToRegexpOptions), // 根据path和选项编译为正则对象
    components: route.components || { default: route.component }, // route.component
    instances: {}, // 实例
    name, // route.name
    parent, // 父路由对象
    matchAs, // 别名路由才有该属性，匹配为 route.path
    redirect: route.redirect, // 重定向地址
    beforeEnter: route.beforeEnter, // 路由级别的导航守卫
    meta: route.meta || {}, // route.meta 路由元信息
    props:
      route.props == null
        ? {}
        : route.components
          ? route.props
          : { default: route.props }
  }
  // 如果存在子路由，递归执行 addRouteRecord 添加路由记录，其实就是会拉平添加到 pathList 和 pathMap
  if (route.children) {
    // Warn if route is named, does not redirect and has a default child route.
    // If users navigate to this route by name, the default child will
    // not be rendered (GH Issue #629)
    if (process.env.NODE_ENV !== 'production') {
      if (
        route.name &&
        !route.redirect &&
        route.children.some(child => /^\/?$/.test(child.path))
      ) {
        warn(
          false,
          `Named Route '${route.name}' has a default child route. ` +
            `When navigating to this named route (:to="{name: '${
              route.name
            }'"), ` +
            `the default child route will not be rendered. Remove the name from ` +
            `this route and use the name of the default child route for named ` +
            `links instead.`
        )
      }
    }
    route.children.forEach(child => {
      const childMatchAs = matchAs
        ? cleanPath(`${matchAs}/${child.path}`)
        : undefined
      addRouteRecord(pathList, pathMap, nameMap, child, record, childMatchAs)
    })
  }
  // 如果路由记录的path在pathMap上不存在，则添加记录
  if (!pathMap[record.path]) {
    pathList.push(record.path)
    pathMap[record.path] = record
  }
  // 如果提供了别名 alias
  if (route.alias !== undefined) {
    const aliases = Array.isArray(route.alias) ? route.alias : [route.alias]
    for (let i = 0; i < aliases.length; ++i) {
      const alias = aliases[i]// 如果别名跟path相同，打印警告
      if (process.env.NODE_ENV !== 'production' && alias === path) {
        warn(
          false,
          `Found an alias with the same value as the path: "${path}". You have to remove that alias. It will be ignored in development.`
        )
        // skip in dev to make it work
        continue
      }
      // 构造别名的路由记录,并添加到路由记录里面
      const aliasRoute = {
        path: alias,
        children: route.children
      }
      addRouteRecord(
        pathList,
        pathMap,
        nameMap,
        aliasRoute,
        parent,
        record.path || '/' // matchAs 匹配为 record.path || '/';  只有别名路由才会设置该属性
      )
    }
  }
  // 如果存在 route.name属性，
  if (name) {
    if (!nameMap[name]) { // 如果  nameMap 不存在该name属性，添加进去
      nameMap[name] = record
    } else if (process.env.NODE_ENV !== 'production' && !matchAs) { // 否则就是存在name同名的路由记录，给出警告
      warn(
        false,
        `Duplicate named routes definition: ` +
          `{ name: "${name}", path: "${record.path}" }`
      )
    }
  }
}
// 编译路由正则对象，将 path 转换为正则对象，使用库path-to-regexp
function compileRouteRegex (
  path: string,
  pathToRegexpOptions: PathToRegexpOptions
): RouteRegExp {
  /**
   * regex.keys 参数数组，形如：
   * {
   * asterisk: false
    delimiter: "/"
    name: "tags"   // 参数名
    optional: true
    partial: false
    pattern: "[^\\/]+?"
    prefix: "/"
    repeat: true
   * }
   */
  const regex = Regexp(path, [], pathToRegexpOptions)
  console.log('regex:::', path, regex, regex.keys)
  if (process.env.NODE_ENV !== 'production') {
    const keys: any = Object.create(null)
    regex.keys.forEach(key => {
      warn(
        !keys[key.name],
        `Duplicate param keys in route with path: "${path}"`
      )
      keys[key.name] = true
    })
  }
  return regex
}
// 序列化path,拼接 parent.path / path
function normalizePath (
  path: string,
  parent?: RouteRecord,
  strict?: boolean
): string {
  // 如果不是严格模式，删掉末尾的 /
  if (!strict) path = path.replace(/\/$/, '')
  if (path[0] === '/') return path
  if (parent == null) return path
  return cleanPath(`${parent.path}/${path}`)
}
