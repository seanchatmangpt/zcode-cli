/**
 * Desktop-managed builtin provider ids and the CLI provider family each one
 * maps to. Shared by the model catalog refresh and the runtime patch that
 * aliases these ids onto the user's configured family provider.
 */
export const builtinCodingPlanFamilies = {
  "builtin:zai-coding-plan": "zai",
  "builtin:bigmodel-coding-plan": "bigmodel"
} as const;

export type BuiltinCodingPlanFamily = (typeof builtinCodingPlanFamilies)[keyof typeof builtinCodingPlanFamilies];
