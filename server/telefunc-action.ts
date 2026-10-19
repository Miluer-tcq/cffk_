import { Abort } from "telefunc";

import { AppError } from "@/lib/app-error";
import { SupplierDomainError } from "@/server/supplier/error";

/**
 * Converts domain errors into Telefunc's expected business-error control flow.
 * Unexpected errors remain untouched so Telefunc reports them as server bugs.
 */
export function telefuncAction<Args extends unknown[], Result>(action: (...args: Args) => Result) {
  return async (...args: Args): Promise<Awaited<Result>> => {
    try {
      return await action(...args);
    } catch (cause) {
      if (cause instanceof AppError) throw Abort({ code: cause.code });
      // 供应商适配器错误（如 API Key 无效、币种不支持、余额不足）是业务错误而非服务端 bug，
      // 必须把 code 透传给前端，否则前端只能显示通用的「操作暂时无法完成」。
      if (cause instanceof SupplierDomainError) throw Abort({ code: cause.code });
      throw cause;
    }
  };
}
