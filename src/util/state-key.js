/* @flow */
import { inBrowser } from './dom'

// use User Timing api (if present) for more accurate key precision
const Time =
  inBrowser && window.performance && window.performance.now
    ? window.performance
    : Date
// 生成状态key,利用时间戳保留3为有效小数
export function genStateKey (): string {
  return Time.now().toFixed(3)
}

let _key: string = genStateKey()
// 获取状态key
export function getStateKey () {
  return _key
}
// 设置状态key
export function setStateKey (key: string) {
  return (_key = key)
}
