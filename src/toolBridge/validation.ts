import Ajv, { type ValidateFunction } from "ajv";
import type { ToolDefinition, ToolValidationResult } from "./types";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

const validatorCache = new WeakMap<ToolDefinition, ValidateFunction>();

export function validateToolArguments(tool: ToolDefinition, args: unknown): ToolValidationResult {
  if (typeof args === "string") {
    return {
      error: `Tool ${tool.id} received arguments that could not be parsed as JSON.`,
      ok: false,
    };
  }

  const validator = getToolValidator(tool);
  const valid = validator(args);

  if (valid) {
    return {
      args: (args ?? {}) as Record<string, unknown>,
      ok: true,
    };
  }

  return {
    error: ajv.errorsText(validator.errors, { separator: "; " }),
    ok: false,
  };
}

function getToolValidator(tool: ToolDefinition): ValidateFunction {
  const cachedValidator = validatorCache.get(tool);

  if (cachedValidator) {
    return cachedValidator;
  }

  const validator = ajv.compile(tool.inputSchema);
  validatorCache.set(tool, validator);
  return validator;
}
