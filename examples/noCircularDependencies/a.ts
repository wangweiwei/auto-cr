import { getB } from './b'

export const getA = (): string => `A -> ${getB()}`
