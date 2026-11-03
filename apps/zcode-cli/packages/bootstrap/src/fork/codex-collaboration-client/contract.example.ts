import type { ReadCollaborationChildrenInput } from "./contract.js";
import { readCollaborationChildren } from "./module.js";
export const example = (input: ReadCollaborationChildrenInput) => readCollaborationChildren(input);
