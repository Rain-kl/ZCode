import { expect, it } from "vitest";
import { exampleRequestClaims } from "./contract.example.js";
it("claims physical requests once", () => expect(exampleRequestClaims()).toEqual([1, 2]));
