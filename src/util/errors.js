// When changing thing, also edit router.d.ts 导航失败类型
export const NavigationFailureType = {
  redirected: 2, // 重定向
  aborted: 4, // 中止
  cancelled: 8, // 取消
  duplicated: 16 // 重复
}
// 创建一个导航重定向错误
export function createNavigationRedirectedError (from, to) {
  return createRouterError(
    from,
    to,
    NavigationFailureType.redirected,
    `Redirected when going from "${from.fullPath}" to "${stringifyRoute(
      to
    )}" via a navigation guard.`
  )
}
// 创建一个导航重复错误
export function createNavigationDuplicatedError (from, to) {
  const error = createRouterError(
    from,
    to,
    NavigationFailureType.duplicated,
    `Avoided redundant navigation to current location: "${from.fullPath}".`
  )
  // backwards compatible with the first introduction of Errors
  error.name = 'NavigationDuplicated'
  return error
}
// 创建一个导航取消错误
export function createNavigationCancelledError (from, to) {
  return createRouterError(
    from,
    to,
    NavigationFailureType.cancelled,
    `Navigation cancelled from "${from.fullPath}" to "${
      to.fullPath
    }" with a new navigation.`
  )
}
// 创建一个导航中止错误
export function createNavigationAbortedError (from, to) {
  return createRouterError(
    from,
    to,
    NavigationFailureType.aborted,
    `Navigation aborted from "${from.fullPath}" to "${
      to.fullPath
    }" via a navigation guard.`
  )
}
// 创建一个路由错误
function createRouterError (from, to, type, message) {
  const error = new Error(message)
  error._isRouter = true
  error.from = from
  error.to = to
  error.type = type

  return error
}

const propertiesToLog = ['params', 'query', 'hash']

function stringifyRoute (to) {
  if (typeof to === 'string') return to
  if ('path' in to) return to.path
  const location = {}
  propertiesToLog.forEach(key => {
    if (key in to) location[key] = to[key]
  })
  return JSON.stringify(location, null, 2)
}

export function isError (err) {
  return Object.prototype.toString.call(err).indexOf('Error') > -1
}
// 导航是否失败
export function isNavigationFailure (err, errorType) {
  return (
    isError(err) &&
    err._isRouter &&
    (errorType == null || err.type === errorType)
  )
}
