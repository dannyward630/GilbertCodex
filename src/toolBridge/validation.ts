import type { ToolDefinition, ToolValidationResult } from "./types";

type SchemaType = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

interface BridgeJsonSchema {
  additionalProperties?: boolean;
  items?: BridgeJsonSchema;
  maxItems?: number;
  maxLength?: number;
  maximum?: number;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  properties?: Record<string, BridgeJsonSchema>;
  required?: string[];
  type?: SchemaType | SchemaType[];
}

export function validateToolArguments(tool: ToolDefinition, args: unknown): ToolValidationResult {
  if (typeof args === "string") {
    return {
      error: `Tool ${tool.id} received arguments that could not be parsed as JSON.`,
      ok: false,
    };
  }

  const errors: string[] = [];
  validateValue(args, tool.inputSchema as BridgeJsonSchema, "arguments", errors);

  if (errors.length === 0) {
    return {
      args: (args ?? {}) as Record<string, unknown>,
      ok: true,
    };
  }

  return {
    error: errors.join("; "),
    ok: false,
  };
}

function validateValue(value: unknown, schema: BridgeJsonSchema, path: string, errors: string[]) {
  if (!matchesSchemaType(value, schema.type)) {
    errors.push(`${path} must be ${formatExpectedType(schema.type)}`);
    return;
  }

  if (isObject(value)) {
    validateObject(value, schema, path, errors);
    return;
  }

  if (Array.isArray(value)) {
    validateArray(value, schema, path, errors);
    return;
  }

  if (typeof value === "string") {
    validateString(value, schema, path, errors);
    return;
  }

  if (typeof value === "number") {
    validateNumber(value, schema, path, errors);
  }
}

function validateObject(value: Record<string, unknown>, schema: BridgeJsonSchema, path: string, errors: string[]) {
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (!propertySchema) {
      if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      }
      continue;
    }

    validateValue(propertyValue, propertySchema, `${path}.${key}`, errors);
  }
}

function validateArray(value: unknown[], schema: BridgeJsonSchema, path: string, errors: string[]) {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    errors.push(`${path} must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
  }

  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    errors.push(`${path} must contain at most ${schema.maxItems} items`);
  }

  if (!schema.items) {
    return;
  }

  value.forEach((item, index) => {
    validateValue(item, schema.items!, `${path}[${index}]`, errors);
  });
}

function validateString(value: string, schema: BridgeJsonSchema, path: string, errors: string[]) {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${path} must be at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`);
  }

  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    errors.push(`${path} must be at most ${schema.maxLength} characters`);
  }
}

function validateNumber(value: number, schema: BridgeJsonSchema, path: string, errors: string[]) {
  if (!Number.isFinite(value)) {
    errors.push(`${path} must be finite`);
    return;
  }

  if (schema.type === "integer" && !Number.isInteger(value)) {
    errors.push(`${path} must be integer`);
  }

  if (typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${path} must be >= ${schema.minimum}`);
  }

  if (typeof schema.maximum === "number" && value > schema.maximum) {
    errors.push(`${path} must be <= ${schema.maximum}`);
  }
}

function matchesSchemaType(value: unknown, expectedType: BridgeJsonSchema["type"]): boolean {
  if (!expectedType) {
    return true;
  }

  const expectedTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
  return expectedTypes.some((type) => matchesSingleType(value, type));
}

function matchesSingleType(value: unknown, expectedType: SchemaType): boolean {
  switch (expectedType) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isObject(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatExpectedType(expectedType: BridgeJsonSchema["type"]): string {
  if (!expectedType) {
    return "a valid value";
  }

  return Array.isArray(expectedType) ? expectedType.join(" or ") : expectedType;
}
