/* @flow */
// 执行队列,
export function runQueue (queue: Array<?NavigationGuard>, fn: Function, cb: Function) {
  const step = index => {
    if (index >= queue.length) { // 如果index大于等于队列的长度，执行 cb
      cb()
    } else {
      if (queue[index]) { // 如果队列里的钩子存在，调用 fn 函数，第二个参数是调用队列的下一个
        fn(queue[index], () => {
          step(index + 1)
        })
      } else {
        step(index + 1)
      }
    }
  }
  step(0)
}
