/* @flow */
// 解析相对路径转换为绝对路径
export function resolvePath (
  relative: string,
  base: string,
  append?: boolean
): string {
  const firstChar = relative.charAt(0)
  if (firstChar === '/') { // 如果第一个字符是/ 返回该相对路径
    return relative
  }
  // 如果首字符是 ? 或 # , 拼接 base并返回
  if (firstChar === '?' || firstChar === '#') {
    return base + relative
  }
  // / 分割 base 得到 stack 栈
  const stack = base.split('/')

  // remove trailing segment if:
  // - not appending
  // - appending to trailing slash (last segment is empty)
  if (!append || !stack[stack.length - 1]) {
    stack.pop()
  }

  // resolve relative path  解析相对路径
  const segments = relative.replace(/^\//, '').split('/')// 相对路径删掉开头的/，然后用/分割为数组
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment === '..') { // 如果是 .. stack弹出最后一项
      stack.pop()
    } else if (segment !== '.') { // 如果不是.推入栈顶
      stack.push(segment)
    }
  }

  // ensure leading slash 确保前导一定是斜杠
  if (stack[0] !== '') {
    stack.unshift('')
  }
  // 返回解析后的 path
  return stack.join('/')
}
// 解析path,返回 path query hash
export function parsePath (path: string): {
  path: string;
  query: string;
  hash: string;
} {
  let hash = ''
  let query = ''

  const hashIndex = path.indexOf('#')
  if (hashIndex >= 0) {
    hash = path.slice(hashIndex)
    path = path.slice(0, hashIndex)
  }

  const queryIndex = path.indexOf('?')
  if (queryIndex >= 0) {
    query = path.slice(queryIndex + 1)
    path = path.slice(0, queryIndex)
  }

  return {
    path,
    query,
    hash
  }
}
// 转义过的双斜线替换成 /
export function cleanPath (path: string): string {
  return path.replace(/\/\//g, '/')
}
