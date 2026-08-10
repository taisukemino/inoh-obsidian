import type { SupabaseClient } from "@supabase/supabase-js";

/** `functions.invoke` result with the `error` narrowed from `any` to `unknown`. */
export type EdgeFunctionResult<ResponseBody> = {
  data: ResponseBody | null;
  error: unknown;
};

/**
 * Invokes a Supabase edge function.
 *
 * Thin wrapper over `supabase.functions.invoke` whose only job is to narrow
 * the response `error` from supabase-js's `any` to `unknown`, so callers must
 * inspect it before use.
 *
 * @param supabase - Signed-in Supabase client
 * @param functionName - The edge function to invoke
 * @param requestBody - JSON body to send
 * @returns The parsed response body, or the error the invocation failed with
 */
export async function invokeEdgeFunction<ResponseBody>(
  supabase: SupabaseClient,
  functionName: string,
  requestBody: Record<string, unknown>,
): Promise<EdgeFunctionResult<ResponseBody>> {
  return await supabase.functions.invoke<ResponseBody>(functionName, { body: requestBody });
}
