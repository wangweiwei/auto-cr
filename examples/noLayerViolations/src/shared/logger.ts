import { orderModel } from '@features/order/model'

export const logger = (): void => {
  console.log(orderModel.totalLabel)
}
