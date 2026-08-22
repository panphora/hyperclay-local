#!/usr/bin/env python3
"""Verify the First Million Stays Yours License's conversion-by-ablation clause.

Applies Section 3's deletion list to a license file and diffs the residue
(Section 2 as amended + Section 7) against the canonical MIT
License body. Exits nonzero, printing a word diff, if they differ.
Run at every fenced release: python3 ablation-check.py [path-to-LICENSE]
"""
import re, sys, difflib

path = sys.argv[1] if len(sys.argv) > 1 else "FIRST-MILLION-STAYS-YOURS-LICENSE.txt"
text = open(path).read()

MIT = """Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE."""


def section(n):
    m = re.search(rf"^\n*{n}\. [A-Z].*?$(.*?)(?=^\d\. [A-Z]|^-{{10,}}|\Z)", text, re.M | re.S)
    return m.group(0) if m else ""


s2 = section(2)
assert s2, "Section 2 not found"
s7 = section(7)
assert s7, "Section 7 not found"

# 3(a): chapeau substitution
s2 = s2.replace(
    "free of charge except as condition (b)\nbelow provides", "free of charge"
)
# 3(b): delete condition (b), the label (a), and the two named paragraphs
s2 = re.sub(r"\n  \(b\) If in a calendar year.*?act on Your part\.\n", "\n", s2, flags=re.S)
s2 = s2.replace("  (a) The above copyright notice", "The above copyright notice")
s2 = re.sub(r"\nBoth \(a\) and \(b\).*?outside the scope of this license\.\n", "\n", s2, flags=re.S)
s2 = re.sub(r"\nIn this license,.*?exercising these rights\.\n", "\n", s2, flags=re.S)
# 3(e): headings dropped
s2 = re.sub(r"^2\. GRANT AND CONDITIONS\s*", "", s2.strip())
s7 = re.sub(r"^7\. DISCLAIMER\s*", "", s7.strip())

residue = s2 + " " + s7


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


a, b = norm(residue), norm(MIT)
print("residue == canonical MIT body:", a == b)
if a != b:
    for line in difflib.unified_diff(b.split(), a.split(), lineterm="", n=2):
        print(line)
    sys.exit(1)

words = len(norm(re.sub(r"-{10,}", " ", text)).split())
print("total words:", words)
print("em/en dashes:", sum(ch in "–—" for ch in text))
