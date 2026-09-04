"""Automation + parsing code that lives entirely inside this repo.

- launch_ibm.py + as400_macros/  - drives the IBM i Access terminal to create
  quotes / invoices / special orders (used by desktop_helper_service.py)
- bulk_form_parser.py, intake_form_parser.py - parse OCR'd intake-form text
- ocr_tool.py - a PyQt OCR helper; ocr_processor.py loads its OCRTool class
  headlessly as a fallback text extractor

These modules are self-contained: no imports or file reads outside the repo
(the only absolute paths are to locally-installed tools - IBM ACS, Tesseract).
"""
