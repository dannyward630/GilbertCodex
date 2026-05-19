import type { ToolDefinition, ToolValidationResult } from "./types";

type SchemaType = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

interface BridgeJsonSchema {
  additionalProperties?: boolean;
  enum?: ReadonlyArray<unknown>;
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

  const compatibleArgs = normalizeKnownToolArguments(tool.id, args ?? {});
  const normalizedArgs = normalizeValueForSchema(compatibleArgs, tool.inputSchema as BridgeJsonSchema);
  const errors: string[] = [];
  validateValue(normalizedArgs, tool.inputSchema as BridgeJsonSchema, "arguments", errors);

  if (errors.length === 0) {
    return {
      args: normalizedArgs as Record<string, unknown>,
      ok: true,
    };
  }

  return {
    error: errors.join("; "),
    ok: false,
  };
}

function normalizeKnownToolArguments(toolId: string, args: unknown): unknown {
  if (!isObject(args)) {
    return args;
  }

  if (toolId === "files_edit_many") {
    return normalizeFilesEditManyArgs(args);
  }

  if (toolId === "files_write_many") {
    return normalizeFilesWriteManyArgs(args);
  }

  if (toolId.startsWith("files_")) {
    const next = { ...args };
    stripEmptyExpectedSha256(next);
    return next;
  }

  return args;
}

function normalizeFilesEditManyArgs(args: Record<string, unknown>) {
  const next = { ...args };

  stripEmptyExpectedSha256(next);
  delete next.insertNewlineBeforeContent;

  if (Array.isArray(next.edits)) {
    next.edits = next.edits.map((item) => {
      if (!isObject(item)) {
        return item;
      }

      const edit = { ...item };
      stripEmptyExpectedSha256(edit);

      if (edit.insertNewlineBeforeContent !== undefined) {
        if (edit.ensureNewline === undefined && edit.ensure_newline === undefined && typeof edit.insertNewlineBeforeContent === "boolean") {
          edit.ensureNewline = edit.insertNewlineBeforeContent;
        }
        delete edit.insertNewlineBeforeContent;
      }

      stripBlankTextField(edit, "oldText");
      stripBlankTextField(edit, "old_text");

      return edit;
    });
  }

  return next;
}

function normalizeFilesWriteManyArgs(args: Record<string, unknown>) {
  const next = { ...args };

  if (next.createParentDirectories !== undefined) {
    if (next.createParentDirs === undefined && typeof next.createParentDirectories === "boolean") {
      next.createParentDirs = next.createParentDirectories;
    }
    delete next.createParentDirectories;
  }

  if (next.allowOverwrite !== undefined) {
    if (next.overwrite === undefined && typeof next.allowOverwrite === "boolean") {
      next.overwrite = next.allowOverwrite;
    }
    delete next.allowOverwrite;
  }

  applyLineEndingAlias(next);

  if (Array.isArray(next.files)) {
    next.files = next.files.map((item) => {
      if (!isObject(item)) {
        return item;
      }

      const file = { ...item };
      stripEmptyExpectedSha256(file);

      if (file.createParentDirectories !== undefined) {
        if (file.createParentDirs === undefined && typeof file.createParentDirectories === "boolean") {
          file.createParentDirs = file.createParentDirectories;
        }
        delete file.createParentDirectories;
      }

      if (file.allowOverwrite !== undefined) {
        if (file.overwrite === undefined && typeof file.allowOverwrite === "boolean") {
          file.overwrite = file.allowOverwrite;
        }
        delete file.allowOverwrite;
      }

      applyLineEndingAlias(file);

      return file;
    });
  }

  return next;
}

function stripEmptyExpectedSha256(record: Record<string, unknown>) {
  const value = record.expectedSha256 ?? record.expected_sha256;

  if (typeof value !== "string") {
    return;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "" || normalizedValue === "unknown") {
    delete record.expectedSha256;
    delete record.expected_sha256;
  }
}

function stripBlankTextField(record: Record<string, unknown>, key: string) {
  if (typeof record[key] === "string" && record[key].trim().length === 0) {
    delete record[key];
  }
}

function applyLineEndingAlias(record: Record<string, unknown>) {
  const lineEnding = typeof record.lineEnding === "string" ? record.lineEnding.trim().toLowerCase() : "";

  if ((lineEnding === "lf" || lineEnding === "crlf") && record.forceEol === undefined) {
    record.forceEol = lineEnding;
  }

  delete record.lineEnding;
}

function normalizeValueForSchema(value: unknown, schema: BridgeJsonSchema): unknown {
  const normalizedPrimitive = normalizePrimitiveForSchema(value, schema);

  if (normalizedPrimitive !== value) {
    return normalizedPrimitive;
  }

  if (isObject(value) && schema.properties) {
    return Object.fromEntries(
      Object.entries(value).map(([key, propertyValue]) => {
        const propertySchema = schema.properties?.[key];
        return [key, propertySchema ? normalizeValueForSchema(propertyValue, propertySchema) : propertyValue];
      }),
    );
  }

  if (Array.isArray(value) && schema.items) {
    return value.map((item) => normalizeValueForSchema(item, schema.items!));
  }

  return value;
}

function normalizePrimitiveForSchema(value: unknown, schema: BridgeJsonSchema): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }

  const expectedTypes = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
  const trimmed = value.trim();

  if (expectedTypes.includes("integer") && /^[-+]?\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : value;
  }

  if (expectedTypes.includes("number") && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }

  if (expectedTypes.includes("boolean")) {
    const normalized = trimmed.toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return value;
}

function validateValue(value: unknown, schema: BridgeJsonSchema, path: string, errors: string[]) {
  if (!matchesSchemaType(value, schema.type)) {
    errors.push(`${path} must be ${formatExpectedType(schema.type)}`);
    return;
  }

  if (schema.enum && schema.enum.length > 0 && !schema.enum.includes(value as never)) {
    errors.push(`${path} must be one of: ${schema.enum.map((entry) => formatEnumValue(entry)).join(", ")}`);
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

function formatEnumValue(value: unknown) {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (value === null) {
    return "null";
  }
  return String(value);
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
