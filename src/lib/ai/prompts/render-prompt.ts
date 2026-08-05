export type PromptVariables = Record<
  string,
  string | number | boolean | null | undefined
>;

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function renderPromptTemplate(
  template: string,
  variables: PromptVariables,
): string {
  return template.replace(VARIABLE_PATTERN, (_match, variableName: string) => {
    const value = variables[variableName];

    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  });
}

export function findMissingPromptVariables(
  template: string,
  variables: PromptVariables,
): string[] {
  const requiredVariables = new Set<string>();

  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const variableName = match[1];

    if (variableName) {
      requiredVariables.add(variableName);
    }
  }

  return [...requiredVariables].filter((variableName) => {
    const value = variables[variableName];
    return value === null || value === undefined || value === "";
  });
}
