// One of the files that prove "reset leaves no rows between files"; see isolation-case.ts.
import { defineIsolationFile } from "./isolation-case";

defineIsolationFile("b");
