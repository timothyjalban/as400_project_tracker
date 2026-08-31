"""Code vendored from the old C:\\Projects\\Order-Tracker desktop project.

- launch_ibm.py + as400_macros/  - drives the IBM i Access terminal to create
  quotes / invoices / special orders (used by desktop_helper_service.py)
- bulk_form_parser.py, intake_form_parser.py - parse OCR'd intake-form text
- ocr_tool.py - a PyQt desktop OCR app; ocr_processor.py loads its OCRTool
  class headlessly as a fallback text extractor

Previously these were reached via sys.path.insert() to the hard-coded old path.
"""
