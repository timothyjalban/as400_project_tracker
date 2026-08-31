"""
Standalone OCR Tool with GUI
Uses EasyOCR for high accuracy text extraction from images
"""

import sys
import os
from pathlib import Path
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QPushButton, QLabel, QTextEdit, 
                             QFileDialog, QProgressBar, QComboBox, QCheckBox,
                             QSplitter, QGroupBox, QSpinBox, QLineEdit, QTabWidget)
from PyQt5.QtCore import Qt, QThread, pyqtSignal, QSize
from PyQt5.QtGui import QPixmap, QImage, QDragEnterEvent, QDropEvent, QFont, QTextCursor
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
import io
import re
import json
from datetime import datetime

try:
    import pytesseract
    # Set Tesseract path for Windows
    if os.path.exists(r'C:\Program Files\Tesseract-OCR\tesseract.exe'):
        pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
except ImportError:
    pytesseract = None

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None


class OCRWorker(QThread):
    """Background thread for OCR processing"""
    finished = pyqtSignal(str, list)
    progress = pyqtSignal(str)
    error = pyqtSignal(str)
    
    def __init__(self, file_path, language='eng', page_num=None, photo_cleanup=False, schedule_mode=False):
        super().__init__()
        self.file_path = file_path
        self.language = language
        self.page_num = page_num
        self.photo_cleanup = photo_cleanup
        self.schedule_mode = schedule_mode

    def _prepare_image_for_ocr(self, image: Image.Image) -> Image.Image:
        """Normalize image for OCR (orientation + RGB mode)."""
        try:
            image = ImageOps.exif_transpose(image)
        except Exception:
            pass
        try:
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
        except Exception:
            pass
        if self.photo_cleanup:
            image = self._cleanup_photo_for_ocr(image)
        image = self._upscale_for_ocr(image)
        return image

    def _cleanup_photo_for_ocr(self, image: Image.Image) -> Image.Image:
        """Improve noisy phone photos for better OCR readability."""
        try:
            grayscale = image.convert("L")
            denoised = grayscale.filter(ImageFilter.MedianFilter(size=3))
            contrasted = ImageEnhance.Contrast(denoised).enhance(1.8)
            sharpened = contrasted.filter(ImageFilter.UnsharpMask(radius=1.6, percent=180, threshold=3))
            normalized = ImageOps.autocontrast(sharpened)
            binary = normalized.point(lambda pixel: 255 if pixel > 150 else 0)
            return binary
        except Exception:
            return image

    def _upscale_for_ocr(self, image: Image.Image) -> Image.Image:
        """Upscale small images to improve OCR readability."""
        try:
            min_width = 1800 if self.photo_cleanup else 1400
            if image.width < min_width:
                scale = min_width / float(image.width)
                new_size = (int(image.width * scale), int(image.height * scale))
                resampling = getattr(Image, "Resampling", Image)
                image = image.resize(new_size, resampling.BICUBIC)
        except Exception:
            pass
        return image

    @staticmethod
    def _merge_text_passes(primary: str, alternate: str) -> str:
        """Merge two OCR passes while removing exact duplicate lines."""
        merged = []
        seen = set()
        for block in (primary, alternate):
            for line in (block or "").splitlines():
                key = re.sub(r"\s+", " ", line.strip().lower())
                if not key:
                    merged.append("")
                    continue
                if key not in seen:
                    seen.add(key)
                    merged.append(line)
        return "\n".join(merged)

    def _extract_schedule_bands(self, image: Image.Image) -> str:
        """Run OCR on horizontal bands to improve schedule/table capture."""
        if not self.schedule_mode:
            return ""

        width, height = image.size
        if height < 240:
            return ""

        band_height = max(220, int(height * 0.16))
        overlap = int(band_height * 0.22)
        y = 0
        band_text = []
        band_cfg = "--oem 3 --psm 4 -c preserve_interword_spaces=1"

        while y < height:
            y2 = min(height, y + band_height)
            band = image.crop((0, y, width, y2))
            text = pytesseract.image_to_string(band, lang=self.language, config=band_cfg)
            if text and text.strip():
                band_text.append(text)
            if y2 >= height:
                break
            y = max(y + 1, y2 - overlap)

        return "\n".join(band_text)

    def _extract_schedule_columns(self, image: Image.Image) -> str:
        """Run OCR on left/right table columns to capture side-by-side schedules."""
        if not self.schedule_mode:
            return ""

        width, height = image.size
        if width < 600 or height < 300:
            return ""

        crops = [
            (0, int(width * 0.55), "LEFT"),
            (int(width * 0.45), width, "RIGHT"),
        ]
        cfgs = [
            "--oem 3 --psm 6 -c preserve_interword_spaces=1",
            "--oem 3 --psm 4 -c preserve_interword_spaces=1",
        ]

        column_text = []
        for x1, x2, label in crops:
            crop = image.crop((x1, 0, x2, height))
            for cfg in cfgs:
                text = pytesseract.image_to_string(crop, lang=self.language, config=cfg)
                if text and text.strip():
                    column_text.append(f"--- {label} TABLE ---\n{text}")

        return "\n".join(column_text)

    def _ocr_text(self, image: Image.Image) -> str:
        """Run OCR with optional multi-pass settings for noisy photos."""
        if not self.photo_cleanup and not self.schedule_mode:
            return pytesseract.image_to_string(image, lang=self.language)

        primary_cfg = "--oem 3 --psm 6 -c preserve_interword_spaces=1"
        alternate_cfg = "--oem 3 --psm 11 -c preserve_interword_spaces=1"
        table_cfg = "--oem 3 --psm 4 -c preserve_interword_spaces=1"

        primary = pytesseract.image_to_string(image, lang=self.language, config=primary_cfg)
        alternate = pytesseract.image_to_string(image, lang=self.language, config=alternate_cfg)
        schedule_hint = self.schedule_mode and re.search(r'\b(window|door)\s+schedule\b', primary, re.IGNORECASE)
        table_text = pytesseract.image_to_string(image, lang=self.language, config=table_cfg) if schedule_hint else ""
        band_text = self._extract_schedule_bands(image) if schedule_hint else ""
        column_text = self._extract_schedule_columns(image) if schedule_hint else ""

        merged = self._merge_text_passes(primary, alternate)
        merged = self._merge_text_passes(merged, table_text)
        merged = self._merge_text_passes(merged, band_text)
        merged = self._merge_text_passes(merged, column_text)
        return merged

    def _ocr_data(self, image: Image.Image):
        """Extract OCR token data with layout-friendly settings."""
        if not self.photo_cleanup:
            return pytesseract.image_to_data(image, lang=self.language, output_type=pytesseract.Output.DICT)

        data_cfg = "--oem 3 --psm 11 -c preserve_interword_spaces=1"
        return pytesseract.image_to_data(
            image,
            lang=self.language,
            config=data_cfg,
            output_type=pytesseract.Output.DICT
        )
        
    def run(self):
        try:
            file_ext = Path(self.file_path).suffix.lower()
            
            if file_ext == '.pdf':
                self.process_pdf()
            else:
                self.process_image()
                
        except Exception as e:
            self.error.emit(f"OCR Error: {str(e)}")
    
    def process_pdf(self):
        """Process PDF file"""
        if fitz is None:
            self.error.emit("PyMuPDF not installed. Cannot process PDF.")
            return
            
        self.progress.emit("Opening PDF...")
        doc = fitz.open(self.file_path)
        
        all_text = []
        all_results = []
        
        # Determine which pages to process
        if self.page_num is not None:
            pages_to_process = [self.page_num - 1]  # Convert to 0-based
        else:
            pages_to_process = range(len(doc))
        
        for page_idx in pages_to_process:
            if page_idx >= len(doc):
                continue
                
            self.progress.emit(f"Processing page {page_idx + 1} of {len(doc)}...")
            
            # Render page to image
            page = doc[page_idx]
            # Extract embedded PDF text (if available) to improve schedule parsing
            try:
                embedded_text = page.get_text("text")
                if embedded_text and embedded_text.strip():
                    all_text.append(f"--- Page {page_idx + 1} (PDF Text) ---\n{embedded_text}\n")
            except Exception:
                pass
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x zoom for better quality
            img_data = pix.tobytes("png")
            image = Image.open(io.BytesIO(img_data))
            image = self._prepare_image_for_ocr(image)
            
            # Perform OCR on the page
            text = self._ocr_text(image)
            all_text.append(f"--- Page {page_idx + 1} ---\n{text}\n")
            
            # Get detailed data
            data = self._ocr_data(image)
            n_boxes = len(data['text'])
            for i in range(n_boxes):
                if int(data['conf'][i]) > 0:
                    all_results.append({
                        'text': data['text'][i],
                        'confidence': int(data['conf'][i]) / 100.0,
                        'bbox': (data['left'][i], data['top'][i], 
                                data['width'][i], data['height'][i]),
                        'page': page_idx + 1
                    })
        
        doc.close()
        full_text = '\n'.join(all_text)
        self.progress.emit("Complete!")
        self.finished.emit(full_text, all_results)
    
    def process_image(self):
        """Process regular image file"""
        self.progress.emit("Processing image...")
        
        # Open image
        image = Image.open(self.file_path)
        image = self._prepare_image_for_ocr(image)
        
        # Perform OCR
        text = self._ocr_text(image)
        
        # Get detailed data with confidence
        data = self._ocr_data(image)
        
        # Extract detailed results
        detailed_results = []
        n_boxes = len(data['text'])
        for i in range(n_boxes):
            if int(data['conf'][i]) > 0:  # Only include recognized text
                detailed_results.append({
                    'text': data['text'][i],
                    'confidence': int(data['conf'][i]) / 100.0,
                    'bbox': (data['left'][i], data['top'][i], 
                            data['width'][i], data['height'][i])
                })
        
        self.progress.emit("Complete!")
        self.finished.emit(text, detailed_results)


class ImageLabel(QLabel):
    """Label that accepts drag and drop for images"""
    
    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self.main_window = main_window
        self.setAcceptDrops(True)
        self.setAlignment(Qt.AlignCenter)
        self.setStyleSheet("""
            QLabel {
                border: 2px dashed #aaa;
                border-radius: 5px;
                background-color: #f5f5f5;
                padding: 20px;
            }
        """)
        self.setText("Drag & Drop Image Here\nor Click Browse")
        self.setMinimumSize(400, 300)
        self.setScaledContents(False)
        
    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            
    def dropEvent(self, event: QDropEvent):
        files = [u.toLocalFile() for u in event.mimeData().urls()]
        if files:
            # Filter for supported file types
            supported_files = [f for f in files if f.lower().endswith(('.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.bmp', '.tiff', '.tif', '.pdf'))]
            
            if not supported_files:
                return
            
            # Always add to batch (even single files can accumulate)
            self.main_window.add_to_batch(supported_files)


class OCRTool(QMainWindow):
    def __init__(self):
        super().__init__()
        self.current_image_path = None
        self.ocr_worker = None
        self._last_parse_text = ""
        self.detailed_results = []
        self.batch_files = []  # Store multiple files for batch processing
        self.batch_results = []  # Store extracted data for all files
        
        self.setWindowTitle("OCR Tool - High Accuracy Text Extraction")
        self.setGeometry(100, 100, 1200, 800)
        
        self.init_ui()
        
    def init_ui(self):
        """Initialize the user interface"""
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        main_layout = QVBoxLayout(central_widget)
        
        # Top controls
        controls_layout = QHBoxLayout()
        
        # Batch queue display
        self.queue_label = QLabel("Queue: 0 files")
        self.queue_label.setStyleSheet("font-weight: bold; color: #2196F3;")
        controls_layout.addWidget(self.queue_label)
        
        view_queue_btn = QPushButton("View Queue")
        view_queue_btn.clicked.connect(self.show_queue_manager)
        view_queue_btn.setStyleSheet("padding: 4px 8px;")
        controls_layout.addWidget(view_queue_btn)
        
        clear_queue_btn = QPushButton("Clear All")
        clear_queue_btn.clicked.connect(self.clear_queue)
        clear_queue_btn.setStyleSheet("padding: 4px 8px;")
        controls_layout.addWidget(clear_queue_btn)
        
        controls_layout.addWidget(QLabel("|"))  # Separator
        
        self.browse_btn = QPushButton("Browse Image")
        self.browse_btn.clicked.connect(self.browse_image)
        controls_layout.addWidget(self.browse_btn)
        
        # Vendor selection
        vendor_label = QLabel("Vendor:")
        controls_layout.addWidget(vendor_label)
        
        self.vendor_combo = QComboBox()
        self.vendor_combo.addItems([
            "Auto-Detect",
            "Andersen",
            "Milgard",
            "San Lorenzo",
            "Architectural Plan",
        ])
        self.vendor_combo.setToolTip("Select the vendor to improve extraction accuracy")
        controls_layout.addWidget(self.vendor_combo)
        
        # Language selection
        lang_label = QLabel("Language:")
        controls_layout.addWidget(lang_label)
        
        self.lang_combo = QComboBox()
        self.lang_combo.addItems([
            "English",
            "Spanish",
            "French",
            "German",
            "Portuguese"
        ])
        controls_layout.addWidget(self.lang_combo)
        
        # Remove GPU option for Tesseract
        controls_layout.addWidget(QLabel(""))  # Spacer
        
        # PDF page selection
        self.page_label = QLabel("PDF Page:")
        self.page_label.setVisible(False)
        controls_layout.addWidget(self.page_label)
        
        self.page_spin = QSpinBox()
        self.page_spin.setMinimum(0)
        self.page_spin.setMaximum(9999)
        self.page_spin.setValue(0)
        self.page_spin.setSpecialValueText("All Pages")
        self.page_spin.setVisible(False)
        controls_layout.addWidget(self.page_spin)
        
        # Text cleaning option
        self.clean_text_check = QCheckBox("Clean Text")
        self.clean_text_check.setChecked(True)
        self.clean_text_check.setToolTip("Remove extra spaces and blank lines")
        controls_layout.addWidget(self.clean_text_check)

        # Photo cleanup option
        self.photo_cleanup_check = QCheckBox("Photo Cleanup")
        self.photo_cleanup_check.setChecked(True)
        self.photo_cleanup_check.setToolTip("Improve OCR on phone photos (denoise, contrast, sharpen, threshold)")
        controls_layout.addWidget(self.photo_cleanup_check)

        # Schedule/table extraction mode
        self.schedule_mode_check = QCheckBox("Schedule Mode")
        self.schedule_mode_check.setChecked(True)
        self.schedule_mode_check.setToolTip("Improves extraction of schedule/table layouts using segmented OCR passes")
        controls_layout.addWidget(self.schedule_mode_check)
        
        # Process current file button (for preview)
        self.process_current_btn = QPushButton("Process Current")
        self.process_current_btn.clicked.connect(self.process_current_file)
        self.process_current_btn.setEnabled(False)
        self.process_current_btn.setVisible(False)
        self.process_current_btn.setStyleSheet("""
            QPushButton {
                background-color: #2196F3;
                color: white;
                font-weight: bold;
                padding: 8px 16px;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #0b7dda;
            }
            QPushButton:disabled {
                background-color: #cccccc;
            }
        """)
        controls_layout.addWidget(self.process_current_btn)
        
        self.process_btn = QPushButton("Extract Text")
        self.process_btn.clicked.connect(self.process_image)
        self.process_btn.setEnabled(False)
        self.process_btn.setStyleSheet("""
            QPushButton {
                background-color: #4CAF50;
                color: white;
                font-weight: bold;
                padding: 8px 16px;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #45a049;
            }
            QPushButton:disabled {
                background-color: #cccccc;
            }
        """)
        controls_layout.addWidget(self.process_btn)
        
        controls_layout.addStretch()
        main_layout.addLayout(controls_layout)
        
        # Splitter for image and text
        splitter = QSplitter(Qt.Horizontal)
        
        # Left side - Image preview
        image_group = QGroupBox("Image Preview")
        image_layout = QVBoxLayout()
        self.image_label = ImageLabel(self)
        image_layout.addWidget(self.image_label)
        image_group.setLayout(image_layout)
        splitter.addWidget(image_group)
        
        # Right side - OCR results with tabs
        results_group = QGroupBox("Extracted Text")
        results_layout = QVBoxLayout()
        
        # Add search bar and font controls
        search_layout = QHBoxLayout()
        
        # Font size control
        search_layout.addWidget(QLabel("Font Size:"))
        self.font_size_spin = QSpinBox()
        self.font_size_spin.setMinimum(8)
        self.font_size_spin.setMaximum(24)
        self.font_size_spin.setValue(10)
        self.font_size_spin.valueChanged.connect(self.update_font_size)
        search_layout.addWidget(self.font_size_spin)
        
        search_layout.addWidget(QLabel("Find:"))
        self.search_box = QLineEdit()
        self.search_box.setPlaceholderText("Search in text...")
        self.search_box.returnPressed.connect(self.search_text)
        search_layout.addWidget(self.search_box)
        
        self.search_btn = QPushButton("Find Next")
        self.search_btn.clicked.connect(self.search_text)
        search_layout.addWidget(self.search_btn)
        results_layout.addLayout(search_layout)
        
        # Tabbed results
        self.result_tabs = QTabWidget()
        
        # Raw text tab
        self.result_text = QTextEdit()
        self.result_text.setPlaceholderText("Extracted text will appear here...")
        font = QFont("Consolas", 10)
        self.result_text.setFont(font)
        self.result_tabs.addTab(self.result_text, "Raw Text")
        
        # Structured data tab
        self.structured_text = QTextEdit()
        self.structured_text.setPlaceholderText("Key fields will be extracted here...")
        self.structured_text.setFont(font)
        self.result_tabs.addTab(self.structured_text, "Key Fields")
        
        results_layout.addWidget(self.result_tabs)
        
        # Buttons for results
        result_buttons = QHBoxLayout()
        
        self.copy_btn = QPushButton("Copy to Clipboard")
        self.copy_btn.clicked.connect(self.copy_to_clipboard)
        result_buttons.addWidget(self.copy_btn)
        
        self.save_btn = QPushButton("Save as Text File")
        self.save_btn.clicked.connect(self.save_as_text)
        result_buttons.addWidget(self.save_btn)
        
        self.export_btn = QPushButton("📋 Export to Order Tracker")
        self.export_btn.clicked.connect(self.export_to_order_tracker)
        self.export_btn.setStyleSheet("""
            QPushButton {
                background-color: #2196F3;
                color: white;
                font-weight: bold;
                padding: 6px 12px;
            }
            QPushButton:hover {
                background-color: #1976D2;
            }
        """)
        result_buttons.addWidget(self.export_btn)

        self.rename_btn = QPushButton("✏️ Rename File (OCR)")
        self.rename_btn.clicked.connect(self.rename_current_file_from_ocr)
        result_buttons.addWidget(self.rename_btn)
        
        self.clear_btn = QPushButton("Clear")
        self.clear_btn.clicked.connect(self.clear_results)
        result_buttons.addWidget(self.clear_btn)
        
        results_layout.addLayout(result_buttons)
        results_group.setLayout(results_layout)
        splitter.addWidget(results_group)
        
        splitter.setSizes([500, 700])
        main_layout.addWidget(splitter)
        
        # Progress bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setTextVisible(True)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                border: 1px solid #ccc;
                border-radius: 3px;
                text-align: center;
            }
            QProgressBar::chunk {
                background-color: #4CAF50;
            }
        """)
        main_layout.addWidget(self.progress_bar)
        
        self.status_label = QLabel("Ready. Load an image to begin.")
        main_layout.addWidget(self.status_label)
        
    def browse_image(self):
        """Open file dialog to select one or more images/PDFs"""
        file_paths, _ = QFileDialog.getOpenFileNames(
            self,
            "Select Image(s) or PDF(s)",
            "",
            "All Supported (*.png *.jpg *.jpeg *.jpe *.jfif *.bmp *.tiff *.tif *.pdf);;Images (*.png *.jpg *.jpeg *.jpe *.jfif *.bmp *.tiff *.tif);;PDF Files (*.pdf);;All Files (*.*)"
        )
        
        if file_paths:
            if len(file_paths) == 1:
                # Single file - use existing behavior
                self.load_image(file_paths[0])
            else:
                # Multiple files - batch mode
                self.load_batch_files(file_paths)
            
    def load_image(self, file_path):
        """Load and display an image or PDF"""
        if not os.path.exists(file_path):
            self.status_label.setText(f"Error: File not found - {file_path}")
            return
        
        # Don't clear batch when loading preview
        # Just update current path
        self.current_image_path = file_path
        file_ext = Path(file_path).suffix.lower()
        
        # Handle PDF
        if file_ext == '.pdf':
            if fitz is None:
                self.status_label.setText("Error: PyMuPDF not installed")
                return
                
            # Show PDF page selector
            self.page_label.setVisible(True)
            self.page_spin.setVisible(True)
            
            # Get page count
            try:
                doc = fitz.open(file_path)
                page_count = len(doc)
                self.page_spin.setMaximum(page_count)
                doc.close()
                
                # Display first page as preview
                doc = fitz.open(file_path)
                page = doc[0]
                pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
                img_data = pix.tobytes("png")
                
                # Convert to QPixmap
                qimage = QImage.fromData(img_data)
                pixmap = QPixmap.fromImage(qimage)
                
                scaled_pixmap = pixmap.scaled(
                    self.image_label.size(),
                    Qt.KeepAspectRatio,
                    Qt.SmoothTransformation
                )
                self.image_label.setPixmap(scaled_pixmap)
                doc.close()
                
                self.process_btn.setEnabled(True)
                self.status_label.setText(f"Loaded PDF: {Path(file_path).name} ({page_count} pages)")
                
            except Exception as e:
                self.status_label.setText(f"Error loading PDF: {str(e)}")
                return
        else:
            # Hide PDF controls for images
            self.page_label.setVisible(False)
            self.page_spin.setVisible(False)
            
            # Display image
            pixmap = QPixmap(file_path)
            if pixmap.isNull():
                self.status_label.setText("Error: Could not load image")
                return
                
            # Scale image to fit label while maintaining aspect ratio
            scaled_pixmap = pixmap.scaled(
                self.image_label.size(),
                Qt.KeepAspectRatio,
                Qt.SmoothTransformation
            )
            self.image_label.setPixmap(scaled_pixmap)
            
            self.process_btn.setEnabled(True)
            self.status_label.setText(f"Loaded: {Path(file_path).name}")
            
            # Enable process current button if in batch mode
            if self.batch_files and len(self.batch_files) > 1:
                self.process_current_btn.setEnabled(True)
        
    def process_image(self):
        """Start OCR processing - handles both single and batch"""
        print("=" * 50)
        print("EXTRACT BUTTON CLICKED!")
        print(f"batch_files count: {len(self.batch_files)}")
        print(f"current_image_path: {self.current_image_path}")
        print("=" * 50)
        
        try:
            # Check if in batch mode (multiple files queued)
            if self.batch_files and len(self.batch_files) > 1:
                print("Entering batch mode")
                self.process_batch_files()
                return
            
            # Single file processing
            if not self.current_image_path:
                print("ERROR: No current_image_path set!")
                self.status_label.setText("Error: No file loaded. Please browse for a file first.")
                return
                
            print(f"Calling process_single_file for: {self.current_image_path}")
            self.process_single_file()
        except Exception as e:
            print(f"ERROR in process_image: {e}")
            import traceback
            traceback.print_exc()
            self.status_label.setText(f"Error: {e}")
    
    def process_single_file(self):
        """Process a single file (internal method)"""
        print("ENTERED process_single_file method!")
        print(f"Type of self: {type(self)}")
        print(f"Has current_image_path attr: {hasattr(self, 'current_image_path')}")
        try:
            print(f"Inside try block - process_single_file called with path: {self.current_image_path}")
            
            if not self.current_image_path:
                print("ERROR: No current_image_path!")
                return
                
            if pytesseract is None:
                self.status_label.setText("Error: pytesseract not installed. Run: pip install pytesseract")
                return
                
            # Get selected language
            lang_map = {
                "English": 'eng',
                "Spanish": 'spa',
                "French": 'fra',
                "German": 'deu',
                "Portuguese": 'por'
            }
            
            selected_lang = lang_map[self.lang_combo.currentText()]
            use_photo_cleanup = self.photo_cleanup_check.isChecked()
            use_schedule_mode = self.schedule_mode_check.isChecked()
            
            # Get page number for PDFs (0 = all pages, None = all pages)
            if self.page_spin.isVisible():
                page_num = self.page_spin.value() if self.page_spin.value() > 0 else None
            else:
                page_num = None
            
            print(f"Starting OCR worker: language={selected_lang}, page={page_num}")
            
            # Disable buttons during processing
            self.process_btn.setEnabled(False)
            self.browse_btn.setEnabled(False)
            self.progress_bar.setRange(0, 0)  # Indeterminate
            
            # Start OCR worker thread
            self.ocr_worker = OCRWorker(
                self.current_image_path,
                selected_lang,
                page_num,
                photo_cleanup=use_photo_cleanup,
                schedule_mode=use_schedule_mode
            )
            self.ocr_worker.finished.connect(self.on_ocr_finished)
            self.ocr_worker.progress.connect(self.on_ocr_progress)
            self.ocr_worker.error.connect(self.on_ocr_error)
            self.ocr_worker.start()
            print("OCR worker started")
        except Exception as e:
            print(f"EXCEPTION in process_single_file: {e}")
            import traceback
            traceback.print_exc()
            self.status_label.setText(f"Error in process_single_file: {e}")
            self.process_btn.setEnabled(True)
            self.browse_btn.setEnabled(True)
        
    def on_ocr_progress(self, message):
        """Update progress"""
        self.status_label.setText(message)
        
    def on_ocr_finished(self, text, detailed_results):
        """Handle OCR completion"""
        print(f"on_ocr_finished called: text length={len(text)}, detailed_results={len(detailed_results)}")
        extraction_text = text

        # Clean text if option is enabled
        if self.clean_text_check.isChecked():
            extraction_text = self.clean_text(extraction_text)

        # Add parsed schedule summary for noisy plan/schedule documents
        if hasattr(self, 'schedule_mode_check') and self.schedule_mode_check.isChecked():
            schedule_summary = self._build_schedule_summary(extraction_text)
            if schedule_summary:
                extraction_text = f"{extraction_text}\n\n{schedule_summary}"

        # Keep an unnumbered copy for parsing/export.
        self._last_parse_text = extraction_text

        # Keep OCR debug table dumps out of the visible Raw Text pane.
        display_text = self._strip_debug_ocr_sections(extraction_text)
        display_text = self._add_line_numbers(display_text)
        
        print(f"Setting result_text with {len(display_text)} characters")
        
        # Make sure we're on the Raw Text tab and set the text
        self.result_text.clear()
        self.result_text.setText(display_text)
        self.result_text.setPlainText(display_text)  # Try both methods
        
        # Switch to Raw Text tab to show results
        if hasattr(self, 'tabs'):
            self.tabs.setCurrentIndex(0)  # Switch to first tab (Raw Text)
        
        self.detailed_results = detailed_results
        
        print(f"Text set in result_text. Widget has {len(self.result_text.toPlainText())} characters")
        
        # Extract key fields using vendor-specific extraction
        extracted_fields = self.extract_fields(extraction_text)
        
        # Get selected vendor (if not auto-detect)
        selected_vendor = None
        if hasattr(self, 'vendor_combo') and self.vendor_combo.currentText() != "Auto-Detect":
            selected_vendor = self.vendor_combo.currentText()
        
        vendor_data = self.extract_vendor_quote_data(extraction_text, extracted_fields, filename=self.current_image_path, pre_selected_vendor=selected_vendor)

        # Auto-rename current source file after successful extraction
        try:
            renamed_path = self._rename_source_path_with_data(
                self.current_image_path,
                vendor_data,
                text=extraction_text,
                refresh_preview=True,
                show_dialog=False
            )
            if renamed_path:
                self.current_image_path = str(renamed_path)
        except Exception as e:
            print(f"Auto-rename warning: {e}")
        
        # Show vendor-specific data if available, otherwise show generic fields
        if vendor_data and vendor_data.get('vendor'):
            # Display vendor-specific extraction
            self.show_vendor_data(vendor_data)
        else:
            # Fallback to generic extraction
            self.show_extracted_fields(extracted_fields)
        
        # Show confidence info
        if detailed_results:
            avg_confidence = sum(r['confidence'] for r in detailed_results) / len(detailed_results)
            confidence_text = f"\n\n--- Confidence: {avg_confidence:.1%} ---"
            self.result_text.append(confidence_text)
        
        self.progress_bar.setRange(0, 1)
        self.progress_bar.setValue(1)
        self.status_label.setText(f"Extraction complete! Found {len(detailed_results)} text blocks.")
        
        # Re-enable buttons
        self.process_btn.setEnabled(True)
        self.browse_btn.setEnabled(True)
        
    def on_ocr_error(self, error_msg):
        """Handle OCR errors"""
        print(f"OCR ERROR: {error_msg}")
        self.status_label.setText(error_msg)
        self.progress_bar.setRange(0, 1)
        self.progress_bar.setValue(0)
        self.process_btn.setEnabled(True)
        self.browse_btn.setEnabled(True)
        
    def copy_to_clipboard(self):
        """Copy extracted text to clipboard"""
        text = self.result_text.toPlainText()
        if text:
            QApplication.clipboard().setText(text)
            self.status_label.setText("Text copied to clipboard!")
    
    def add_to_batch(self, file_paths):
        """Add files to batch queue"""
        for file_path in file_paths:
            if file_path not in self.batch_files:
                self.batch_files.append(file_path)
        
        self.update_queue_display()
        
        # Load last added file as preview
        if file_paths:
            self.load_image(file_paths[-1])
    
    def clear_queue(self):
        """Clear the batch queue"""
        self.batch_files = []
        self.batch_results = []
        self.update_queue_display()
        self.status_label.setText("Queue cleared. Ready to load files.")
    
    def update_queue_display(self):
        """Update the queue label and process button"""
        count = len(self.batch_files)
        self.queue_label.setText(f"Queue: {count} file{'s' if count != 1 else ''}")
        
        if count > 1:
            # Multiple files - show batch button and current file button
            self.process_btn.setText(f"Process All {count} Files")
            self.process_btn.setEnabled(True)
            self.process_current_btn.setVisible(True)
            if self.current_image_path:
                self.process_current_btn.setEnabled(True)
        elif count == 1:
            # Single file in queue - hide current button, use main button
            self.process_btn.setText("Process")
            self.process_btn.setEnabled(True)
            self.process_current_btn.setVisible(False)
        else:
            # No files in queue - but might have a loaded file
            self.process_btn.setText("Process")
            # Keep button enabled if a file is loaded
            if self.current_image_path:
                self.process_btn.setEnabled(True)
            else:
                self.process_btn.setEnabled(False)
            self.process_current_btn.setVisible(False)
    
    def process_current_file(self):
        """Process just the currently loaded file (for preview)"""
        if not self.current_image_path:
            return
        
        # Temporarily clear batch mode
        saved_batch = self.batch_files
        self.batch_files = []
        
        # Process the single file
        self.process_single_file()
        
        # Restore batch
        self.batch_files = saved_batch
    
    def show_queue_manager(self):
        """Show dialog to manage queued files"""
        from PyQt5.QtWidgets import QDialog, QVBoxLayout, QListWidget, QPushButton, QHBoxLayout, QListWidgetItem
        
        if not self.batch_files:
            from PyQt5.QtWidgets import QMessageBox
            QMessageBox.information(self, "Empty Queue", "No files in queue. Drag and drop files to add them.")
            return
        
        dialog = QDialog(self)
        dialog.setWindowTitle(f"Queue Manager - {len(self.batch_files)} Files")
        dialog.resize(600, 400)
        
        layout = QVBoxLayout(dialog)
        
        # Instructions
        layout.addWidget(QLabel("Click a file to preview it. Select and remove unwanted files:"))
        
        # List widget with files
        list_widget = QListWidget()
        for file_path in self.batch_files:
            item = QListWidgetItem(Path(file_path).name)
            item.setData(Qt.UserRole, file_path)  # Store full path
            item.setToolTip(file_path)
            list_widget.addItem(item)
        
        # Connect click to preview
        list_widget.itemClicked.connect(lambda item: self.load_image(item.data(Qt.UserRole)))
        
        layout.addWidget(list_widget)
        
        # Buttons
        button_layout = QHBoxLayout()
        
        remove_btn = QPushButton("Remove Selected")
        remove_btn.clicked.connect(lambda: self.remove_from_queue(list_widget, dialog))
        button_layout.addWidget(remove_btn)
        
        close_btn = QPushButton("Done")
        close_btn.clicked.connect(dialog.close)
        button_layout.addWidget(close_btn)
        
        layout.addLayout(button_layout)
        
        dialog.exec_()
    
    def remove_from_queue(self, list_widget, dialog):
        """Remove selected files from queue"""
        selected_items = list_widget.selectedItems()
        if not selected_items:
            return
        
        # Remove selected files
        for item in selected_items:
            file_path = item.data(Qt.UserRole)
            if file_path in self.batch_files:
                self.batch_files.remove(file_path)
        
        # Update display
        self.update_queue_display()
        
        # Refresh the list widget
        for item in selected_items:
            list_widget.takeItem(list_widget.row(item))
        
        # Close dialog if queue is empty
        if not self.batch_files:
            dialog.close()
            self.status_label.setText("Queue is now empty.")
    
    def load_batch_files(self, file_paths):
        """Load multiple files for batch processing"""
        self.batch_files = file_paths
        self.batch_results = []
        self.update_queue_display()
        
        # Load first file as preview
        if file_paths:
            self.load_image(file_paths[0])
    
    def process_batch_files(self):
        """Process all files in batch"""
        if not self.batch_files:
            return
        
        from PyQt5.QtWidgets import QMessageBox
        
        reply = QMessageBox.question(
            self,
            "Batch Processing",
            f"Process {len(self.batch_files)} files?\n\nThis will extract quote data from each file.",
            QMessageBox.Yes | QMessageBox.No
        )
        
        if reply != QMessageBox.Yes:
            return
        
        self.process_btn.setEnabled(False)
        self.browse_btn.setEnabled(False)
        self.batch_results = []
        
        # Process each file
        for idx, file_path in enumerate(self.batch_files):
            self.status_label.setText(f"Processing file {idx + 1} of {len(self.batch_files)}: {Path(file_path).name}")
            self.progress_bar.setValue(int((idx / len(self.batch_files)) * 100))
            QApplication.processEvents()  # Keep UI responsive
            
            # Load and process this file
            self.current_image_path = file_path
            lang_map = {"English": "eng", "Spanish": "spa", "French": "fra", "German": "deu", "Portuguese": "por"}
            language = lang_map.get(self.lang_combo.currentText(), "eng")
            page_num = self.page_spin.value() if self.page_spin.value() > 0 else None
            use_photo_cleanup = self.photo_cleanup_check.isChecked()
            use_schedule_mode = self.schedule_mode_check.isChecked()
            
            # Process synchronously for batch
            try:
                file_ext = Path(file_path).suffix.lower()
                if file_ext == '.pdf':
                    text = self.process_pdf_sync(
                        file_path,
                        language,
                        page_num,
                        photo_cleanup=use_photo_cleanup,
                        schedule_mode=use_schedule_mode
                    )
                else:
                    text = self.process_image_sync(
                        file_path,
                        language,
                        photo_cleanup=use_photo_cleanup,
                        schedule_mode=use_schedule_mode
                    )
                
                if use_schedule_mode:
                    schedule_summary = self._build_schedule_summary(text)
                    if schedule_summary:
                        text = f"{text}\n\n{schedule_summary}"

                display_text = self._strip_debug_ocr_sections(text)
                display_text = self._add_line_numbers(display_text)

                # Extract vendor data (pass filename for metadata extraction)
                filename = Path(file_path).name
                
                # Get selected vendor (if not auto-detect)
                selected_vendor = None
                if hasattr(self, 'vendor_combo') and self.vendor_combo.currentText() != "Auto-Detect":
                    selected_vendor = self.vendor_combo.currentText()
                
                data = self.extract_vendor_quote_data(text, {}, filename=filename, pre_selected_vendor=selected_vendor)
                
                # Always store the file info and text
                data['source_file'] = Path(file_path).name
                data['_source_path'] = str(Path(file_path))
                data['_extracted_text'] = display_text  # Store cleaned text for preview
                data['_parse_text'] = text  # Preserve raw text for re-parsing operations

                # Auto-rename each source file immediately after extraction
                try:
                    renamed_target = self._rename_source_path_with_data(
                        str(file_path),
                        data,
                        text=text,
                        refresh_preview=False,
                        show_dialog=False
                    )
                    if renamed_target:
                        data['source_file'] = renamed_target.name
                        data['_source_path'] = str(renamed_target)
                except Exception as e:
                    print(f"Auto-rename warning for {Path(file_path).name}: {e}")
                
                # Only add if we got some data OR we want to see all files
                if data and any(v for k, v in data.items() if k not in ['source_file', '_extracted_text']):
                    self.batch_results.append(data)
                    print(f"✓ Extracted data from {Path(file_path).name}: {data.get('vendor', 'Unknown')} - {data.get('customer_name', 'No customer')}")
                else:
                    # Still add to results so user can see what was extracted (or not)
                    self.batch_results.append(data)
                    print(f"⚠ Partial/No data extracted from {Path(file_path).name} - text length: {len(text)} chars")
                
            except Exception as e:
                print(f"✗ Error processing {Path(file_path).name}: {str(e)}")
                import traceback
                traceback.print_exc()
                self.status_label.setText(f"Error processing {Path(file_path).name}: {str(e)}")
        
        self.progress_bar.setValue(100)
        self.show_batch_results()
        self.process_btn.setEnabled(True)
        self.browse_btn.setEnabled(True)
    
    def _cleanup_photo_for_ocr(self, image: Image.Image) -> Image.Image:
        """Improve noisy phone photos for better OCR readability."""
        try:
            grayscale = image.convert("L")
            denoised = grayscale.filter(ImageFilter.MedianFilter(size=3))
            contrasted = ImageEnhance.Contrast(denoised).enhance(1.8)
            sharpened = contrasted.filter(ImageFilter.UnsharpMask(radius=1.6, percent=180, threshold=3))
            normalized = ImageOps.autocontrast(sharpened)
            binary = normalized.point(lambda pixel: 255 if pixel > 150 else 0)
            return binary
        except Exception:
            return image

    def _upscale_for_ocr(self, image: Image.Image, photo_cleanup=False) -> Image.Image:
        """Upscale small images to improve OCR readability."""
        try:
            min_width = 1800 if photo_cleanup else 1400
            if image.width < min_width:
                scale = min_width / float(image.width)
                new_size = (int(image.width * scale), int(image.height * scale))
                resampling = getattr(Image, "Resampling", Image)
                image = image.resize(new_size, resampling.BICUBIC)
        except Exception:
            pass
        return image

    @staticmethod
    def _merge_text_passes(primary: str, alternate: str) -> str:
        """Merge two OCR passes while removing exact duplicate lines."""
        merged = []
        seen = set()
        for block in (primary, alternate):
            for line in (block or "").splitlines():
                key = re.sub(r"\s+", " ", line.strip().lower())
                if not key:
                    merged.append("")
                    continue
                if key not in seen:
                    seen.add(key)
                    merged.append(line)
        return "\n".join(merged)

    def _extract_schedule_bands_sync(self, image: Image.Image, language, schedule_mode=False) -> str:
        """Run OCR on horizontal bands to improve schedule/table capture."""
        if not schedule_mode:
            return ""

        width, height = image.size
        if height < 240:
            return ""

        band_height = max(220, int(height * 0.16))
        overlap = int(band_height * 0.22)
        y = 0
        band_text = []
        band_cfg = "--oem 3 --psm 4 -c preserve_interword_spaces=1"

        while y < height:
            y2 = min(height, y + band_height)
            band = image.crop((0, y, width, y2))
            text = pytesseract.image_to_string(band, lang=language, config=band_cfg)
            if text and text.strip():
                band_text.append(text)
            if y2 >= height:
                break
            y = max(y + 1, y2 - overlap)

        return "\n".join(band_text)

    def _extract_schedule_columns_sync(self, image: Image.Image, language, schedule_mode=False) -> str:
        """Run OCR on left/right table columns to capture side-by-side schedules."""
        if not schedule_mode:
            return ""

        width, height = image.size
        if width < 600 or height < 300:
            return ""

        crops = [
            (0, int(width * 0.55), "LEFT"),
            (int(width * 0.45), width, "RIGHT"),
        ]
        cfgs = [
            "--oem 3 --psm 6 -c preserve_interword_spaces=1",
            "--oem 3 --psm 4 -c preserve_interword_spaces=1",
        ]

        column_text = []
        for x1, x2, label in crops:
            crop = image.crop((x1, 0, x2, height))
            for cfg in cfgs:
                text = pytesseract.image_to_string(crop, lang=language, config=cfg)
                if text and text.strip():
                    column_text.append(f"--- {label} TABLE ---\n{text}")

        return "\n".join(column_text)

    def _ocr_text_sync(self, image: Image.Image, language, photo_cleanup=False, schedule_mode=False) -> str:
        """Run OCR with optional multi-pass settings for noisy photos."""
        if not photo_cleanup and not schedule_mode:
            return pytesseract.image_to_string(image, lang=language)

        primary_cfg = "--oem 3 --psm 6 -c preserve_interword_spaces=1"
        alternate_cfg = "--oem 3 --psm 11 -c preserve_interword_spaces=1"
        table_cfg = "--oem 3 --psm 4 -c preserve_interword_spaces=1"
        primary = pytesseract.image_to_string(image, lang=language, config=primary_cfg)
        alternate = pytesseract.image_to_string(image, lang=language, config=alternate_cfg)
        schedule_hint = schedule_mode and re.search(r'\b(window|door)\s+schedule\b', primary, re.IGNORECASE)
        table_text = pytesseract.image_to_string(image, lang=language, config=table_cfg) if schedule_hint else ""
        band_text = self._extract_schedule_bands_sync(image, language, schedule_mode=schedule_hint)
        column_text = self._extract_schedule_columns_sync(image, language, schedule_mode=schedule_hint)
        merged = self._merge_text_passes(primary, alternate)
        merged = self._merge_text_passes(merged, table_text)
        merged = self._merge_text_passes(merged, band_text)
        merged = self._merge_text_passes(merged, column_text)
        return merged

    def _prepare_image_for_ocr(self, image: Image.Image, photo_cleanup=False) -> Image.Image:
        """Normalize image for OCR (orientation + mode), with optional photo cleanup."""
        try:
            image = ImageOps.exif_transpose(image)
        except Exception:
            pass
        try:
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
        except Exception:
            pass
        if photo_cleanup:
            image = self._cleanup_photo_for_ocr(image)
        image = self._upscale_for_ocr(image, photo_cleanup=photo_cleanup)
        return image

    def process_pdf_sync(self, file_path, language, page_num, photo_cleanup=False, schedule_mode=False):
        """Synchronously process PDF and return text"""
        doc = fitz.open(file_path)
        all_text = []
        
        pages_to_process = [page_num - 1] if page_num else range(len(doc))
        
        for page_idx in pages_to_process:
            if page_idx >= len(doc):
                continue
            page = doc[page_idx]
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            img_data = pix.tobytes("png")
            image = Image.open(io.BytesIO(img_data))
            image = self._prepare_image_for_ocr(image, photo_cleanup=photo_cleanup)
            text = self._ocr_text_sync(image, language, photo_cleanup=photo_cleanup, schedule_mode=schedule_mode)
            all_text.append(text)
        
        doc.close()
        return "\n".join(all_text)
    
    def process_image_sync(self, file_path, language, photo_cleanup=False, schedule_mode=False):
        """Synchronously process image and return text"""
        image = Image.open(file_path)
        image = self._prepare_image_for_ocr(image, photo_cleanup=photo_cleanup)
        return self._ocr_text_sync(image, language, photo_cleanup=photo_cleanup, schedule_mode=schedule_mode)
    
    def show_batch_results(self):
        """Show dialog with all extracted quotes"""
        from PyQt5.QtWidgets import (QDialog, QVBoxLayout, QTableWidget, QTableWidgetItem, 
                                      QPushButton, QHBoxLayout, QMessageBox, QTextEdit, QSplitter)
        from PyQt5.QtCore import Qt
        
        # If no results, show error message
        if not self.batch_results:
            QMessageBox.warning(
                self,
                "No Data Extracted",
                f"No quote data could be extracted from the {len(self.batch_files)} selected file(s).\n\n"
                "This could mean:\n"
                "• The PDFs are image-based and need OCR processing\n"
                "• The vendor format is not recognized\n"
                "• The PDFs are encrypted or corrupted\n\n"
                "Try processing individual files first to diagnose the issue."
            )
            return
        
        dialog = QDialog(self)
        dialog.setWindowTitle("Batch Extraction Results")
        dialog.resize(1000, 700)
        
        layout = QVBoxLayout(dialog)
        
        # Info label
        info_label = QLabel(f"Extracted {len(self.batch_results)} of {len(self.batch_files)} quotes. Review and export:")
        layout.addWidget(info_label)
        
        # Splitter for table and text preview
        splitter = QSplitter(Qt.Vertical)
        
        # Table
        table = QTableWidget()
        table.setColumnCount(6)
        table.setHorizontalHeaderLabels(["File", "Vendor", "Customer", "Quote #", "Date", "Total"])
        table.setRowCount(len(self.batch_results))
        
        for i, data in enumerate(self.batch_results):
            table.setItem(i, 0, QTableWidgetItem(data.get('source_file', '')))
            table.setItem(i, 1, QTableWidgetItem(data.get('vendor', '')))
            table.setItem(i, 2, QTableWidgetItem(data.get('customer_name', '')))
            table.setItem(i, 3, QTableWidgetItem(data.get('quote_number', '')))
            table.setItem(i, 4, QTableWidgetItem(data.get('quote_date', '')))
            table.setItem(i, 5, QTableWidgetItem(data.get('quote_total', '')))
        
        table.resizeColumnsToContents()
        splitter.addWidget(table)
        
        # Text preview area
        preview_label = QLabel("Extracted Text Preview (click a row to view):")
        text_preview = QTextEdit()
        text_preview.setReadOnly(True)
        text_preview.setPlaceholderText("Select a row to view extracted OCR text...")
        
        preview_container = QWidget()
        preview_layout = QVBoxLayout(preview_container)
        preview_layout.setContentsMargins(0, 5, 0, 0)
        preview_layout.addWidget(preview_label)
        preview_layout.addWidget(text_preview)
        
        splitter.addWidget(preview_container)
        splitter.setSizes([300, 300])
        
        layout.addWidget(splitter)
        
        # Update text preview when row is selected
        def on_row_selected():
            selected_row = table.currentRow()
            if selected_row >= 0 and selected_row < len(self.batch_results):
                extracted_text = self.batch_results[selected_row].get('_extracted_text', 'No text available')
                text_preview.setText(extracted_text)
        
        table.currentCellChanged.connect(lambda row, col, prev_row, prev_col: on_row_selected())
        
        # Buttons
        button_layout = QHBoxLayout()
        
        export_btn = QPushButton("Export All to Order Tracker")
        export_btn.clicked.connect(lambda: self.export_batch_results(dialog))
        button_layout.addWidget(export_btn)

        rename_btn = QPushButton("Rename Source Files (OCR)")
        rename_btn.clicked.connect(lambda: self.rename_batch_source_files(dialog))
        button_layout.addWidget(rename_btn)
        
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(dialog.close)
        button_layout.addWidget(close_btn)
        
        layout.addLayout(button_layout)
        
        dialog.exec_()
    
    def export_batch_results(self, dialog):
        """Export all batch results as JSON array"""
        from PyQt5.QtWidgets import QMessageBox
        
        if not self.batch_results:
            return
        
        # Save as JSON array
        output_path = (Path(__file__).resolve().parent.parent / "ocr_import_temp.json")
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(self.batch_results, f, indent=2, ensure_ascii=False)
            
            summary = f"Exported {len(self.batch_results)} quotes:\n\n"
            for data in self.batch_results:
                summary += f"• {data.get('customer_name', 'Unknown')} - {data.get('vendor', 'Unknown')} - ${data.get('quote_total', '0')}\n"
            
            QMessageBox.information(
                self,
                "Batch Export Ready",
                f"{summary}\n\nOpen Order Tracker and click 'Import from OCR' to load all quotes."
            )
            
            dialog.close()
            
        except Exception as e:
            self.status_label.setText(f"Export error: {str(e)}")

    def _slug_for_filename(self, value: str, max_len: int = 40) -> str:
        """Filesystem-safe slug: keep letters/digits/_-, collapse spaces to _, trim."""
        if not value:
            return "unnamed"
        value = value.strip().replace(" ", "_")
        value = re.sub(r"[^A-Za-z0-9_\-]", "", value)
        value = re.sub(r"_+", "_", value).strip("_-")
        return value[:max_len] or "unnamed"

    def _normalize_vendor_for_filename(self, vendor: str) -> str:
        """Normalize vendor token for filename format."""
        token = self._slug_for_filename(vendor or "UnknownVendor", 24)
        lower = token.lower()
        if "tmcobb" in lower or "cobb" in lower:
            return "TMCobb"
        if "milgard" in lower:
            return "Milgard"
        if "san" in lower and "lorenzo" in lower:
            return "SanLorenzo"
        return token

    def _resolve_customer_name_for_filename(self, data: dict, source_path: str, text: str = "") -> str:
        """Resolve best customer name for filename with OCR/text fallbacks."""
        # 1) Direct extracted value
        direct_name = (data.get('customer_name') or '').strip()
        if direct_name:
            return re.sub(r'\s+', ' ', direct_name)

        # 2) Try metadata parsed from existing filename pattern
        try:
            meta = self.parse_filename_metadata(Path(source_path).name)
            meta_name = (meta.get('customer_name') or '').strip()
            if meta_name:
                return re.sub(r'\s+', ' ', meta_name)
        except Exception:
            pass

        # 3) Text-based fallbacks (prioritize OrePac sidemark-style names)
        text_data = text or ""
        patterns = [
            r'QuoteNo\s*\|\s*PO\s*\|\s*sidemark\s*\|[^\n]*\n\s*\d+\s+([^\n\|]+)',
            r'Quote\s*No\s*\nPO\s*\nSidemark\s*\nNotes\s*\n\d+\s*\n([^\n]+)',
            r'Quote Name:\s*([^\n]+?)(?:\s+Quote Number:|\n)',
            r'Customer:\s*([^\n]+?)(?:Salesperson:|$)',
            r'Name:\s*([^\n]+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, text_data, re.IGNORECASE)
            if not match:
                continue
            candidate = re.sub(r'\s+', ' ', match.group(1)).strip()
            if not candidate:
                continue
            # Reject obvious non-person/account markers
            if any(k in candidate.lower() for k in ['contractor', 'sql', 'ship-to', 'location', 'door shop']):
                continue
            # Strip trailing phone if present
            candidate = re.sub(r'\s+\d{3}[-\.]?\d{3}[-\.]?\d{4}\s*$', '', candidate).strip()
            if candidate:
                return candidate

        return "Unknown Customer"

    def _normalize_product_for_filename(self, product_type: str) -> str:
        """Normalize product token for filename format."""
        product = (product_type or "").lower()
        if "door" in product:
            return "Door"
        if "window" in product:
            return "Window"
        return "Other"

    def _resolve_product_for_filename(self, data: dict, text: str = "") -> str:
        """Resolve product token with fallbacks from line items and OCR text."""
        # 1) Direct extracted product_type
        normalized = self._normalize_product_for_filename(data.get('product_type') or "")
        if normalized != "Other":
            return normalized

        # 2) Look into line_items payload (common for OrePac)
        try:
            raw_items = data.get('line_items') or ""
            if raw_items:
                items = json.loads(raw_items) if isinstance(raw_items, str) else raw_items
                if isinstance(items, list):
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        item_text = " ".join([
                            str(item.get('product_type', '')),
                            str(item.get('product_line', '')),
                            str(item.get('description', '')),
                        ])
                        item_norm = self._normalize_product_for_filename(item_text)
                        if item_norm != "Other":
                            return item_norm
        except Exception:
            pass

        # 3) Text fallback (PDF/OCR body)
        return self._normalize_product_for_filename(text)

    def _normalize_date_for_filename(self, quote_date: str) -> str:
        """Convert common date formats to MM-DD-YYYY."""
        date_text = (quote_date or "").strip()
        if not date_text:
            return datetime.now().strftime("%m-%d-%Y")

        for fmt in ("%m/%d/%Y", "%m-%d-%Y", "%Y-%m-%d", "%m/%d/%y", "%m-%d-%y"):
            try:
                parsed = datetime.strptime(date_text, fmt)
                return parsed.strftime("%m-%d-%Y")
            except Exception:
                pass
        return datetime.now().strftime("%m-%d-%Y")

    def _infer_document_type(self, data: dict, source_path: str, text: str = "") -> str:
        """Infer canonical document type token for filename suffix."""
        allowed = {"quote", "invoice", "signoff", "costsheet", "soa"}

        explicit = (data.get('document_type') or "").strip().lower()
        if explicit in allowed:
            return "SOA" if explicit == "soa" else explicit

        stem = Path(source_path).stem.lower()
        for token in ("quote", "invoice", "signoff", "costsheet", "soa"):
            if re.search(rf"(?:^|[_\-]){token}(?:$|[_\-])", stem):
                return "SOA" if token == "soa" else token

        text_lower = (text or "").lower()
        if "invoice" in text_lower:
            return "invoice"
        if "sign off" in text_lower or "signoff" in text_lower:
            return "signoff"
        if "cost sheet" in text_lower or "costsheet" in text_lower:
            return "costsheet"
        if "soa" in text_lower or "vendor ack" in text_lower or "acknowledg" in text_lower:
            return "SOA"
        return "quote"

    def _build_tracker_style_filename(self, data: dict, source_path: str, text: str = "") -> str:
        """Build filename as firstname_lastname_Vendor_Product_MM-DD-YYYY_documenttype.ext."""
        src = Path(source_path)
        ext = src.suffix or ".pdf"

        full_name = self._resolve_customer_name_for_filename(data, source_path, text=text)
        name_parts = [p for p in re.split(r"\s+", full_name) if p]
        first = self._slug_for_filename(name_parts[0], 24) if name_parts else "Unknown"
        # Collapse all remaining name parts into a single last-name token with no spaces
        # Example: "De La Cruz" -> "DeLaCruz"
        if len(name_parts) > 1:
            last_raw = "".join(name_parts[1:])
            last = self._slug_for_filename(last_raw, 24)
        else:
            last = "Customer"

        vendor = self._normalize_vendor_for_filename(data.get('vendor') or "")
        product = self._resolve_product_for_filename(data, text=text)
        date_token = self._normalize_date_for_filename(data.get('quote_date') or "")
        doc_type = self._infer_document_type(data, source_path, text=text)

        return f"{first}_{last}_{vendor}_{product}_{date_token}_{doc_type}{ext}"

    def _unique_path_for_rename(self, target: Path) -> Path:
        """Return a unique path if target already exists by appending _N."""
        if not target.exists():
            return target

        stem = target.stem
        suffix = target.suffix
        parent = target.parent
        i = 1
        while True:
            candidate = parent / f"{stem}_{i}{suffix}"
            if not candidate.exists():
                return candidate
            i += 1

    def _rename_source_path_with_data(self, source_path: str, data: dict, text: str = "", refresh_preview: bool = False, show_dialog: bool = False):
        """Rename a source file using already-extracted OCR data. Returns new Path or None if unchanged."""
        from PyQt5.QtWidgets import QMessageBox

        if not source_path:
            return None

        src = Path(source_path)
        if not src.exists():
            return None

        new_name = self._build_tracker_style_filename(data or {}, str(src), text=text)
        target = self._unique_path_for_rename(src.with_name(new_name))

        if src.resolve() == target.resolve():
            return None

        src.rename(target)

        if refresh_preview:
            try:
                self.load_image(str(target))
            except Exception:
                pass

        self.status_label.setText(f"Renamed: {src.name} → {target.name}")
        if show_dialog:
            QMessageBox.information(self, "Rename Complete", f"Renamed file:\n{src.name}\n→\n{target.name}")

        return target

    def rename_current_file_from_ocr(self):
        """Rename current source file using OCR-extracted data and project naming format."""
        if not self.current_image_path:
            self.status_label.setText("No source file loaded.")
            return

        src = Path(self.current_image_path)
        if not src.exists():
            self.status_label.setText("Source file no longer exists.")
            return

        text = self._get_text_for_parsing()
        if not text:
            self.status_label.setText("No OCR text available. Run OCR first.")
            return

        fields = self.extract_fields(text)
        vendor_data = self.extract_vendor_quote_data(text, fields, filename=src.name)
        try:
            target = self._rename_source_path_with_data(
                str(src),
                vendor_data,
                text=text,
                refresh_preview=True,
                show_dialog=True
            )
            if target:
                self.current_image_path = str(target)
            else:
                self.status_label.setText("File already matches OCR naming format.")
        except Exception as e:
            self.status_label.setText(f"Rename error: {str(e)}")

    def rename_batch_source_files(self, dialog):
        """Rename all batch source files using OCR-extracted data and project naming format."""
        from PyQt5.QtWidgets import QMessageBox

        if not self.batch_results:
            return

        renamed = 0
        skipped = 0
        errors = []

        for data in self.batch_results:
            source_path = data.get('_source_path')
            if not source_path:
                skipped += 1
                continue

            src = Path(source_path)
            if not src.exists():
                skipped += 1
                continue

            try:
                target = self._rename_source_path_with_data(
                    str(src),
                    data,
                    text=data.get('_parse_text') or data.get('_extracted_text', ''),
                    refresh_preview=False,
                    show_dialog=False
                )
                if not target:
                    skipped += 1
                    continue
                data['source_file'] = target.name
                data['_source_path'] = str(target)
                renamed += 1
            except Exception as e:
                errors.append(f"{src.name}: {e}")

        self.status_label.setText(f"Batch rename complete. Renamed: {renamed}, Skipped: {skipped}, Errors: {len(errors)}")

        if errors:
            detail = "\n".join(errors[:10])
            if len(errors) > 10:
                detail += f"\n...and {len(errors) - 10} more"
            QMessageBox.warning(
                self,
                "Batch Rename Completed with Errors",
                f"Renamed: {renamed}\nSkipped: {skipped}\nErrors: {len(errors)}\n\n{detail}"
            )
        else:
            QMessageBox.information(
                self,
                "Batch Rename Complete",
                f"Renamed: {renamed}\nSkipped: {skipped}\nErrors: 0"
            )

        try:
            dialog.close()
        except Exception:
            pass
            
    def save_as_text(self):
        """Save extracted text to a file"""
        text = self.result_text.toPlainText()
        if not text:
            return
            
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "Save Text File",
            "",
            "Text Files (*.txt);;All Files (*.*)"
        )
        
        if file_path:
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(text)
                self.status_label.setText(f"Saved to: {file_path}")
            except Exception as e:
                self.status_label.setText(f"Error saving file: {str(e)}")
    
    def export_to_order_tracker(self):
        """Export extracted fields to Order Tracker"""
        text = self._get_text_for_parsing()
        if not text:
            self.status_label.setText("No text to export!")
            return
        
        # Extract fields
        fields = self.extract_fields(text)
        
        # Enhanced extraction for vendor quotes (include filename for metadata)
        filename = Path(self.current_image_path).name if self.current_image_path else None
        vendor_data = self.extract_vendor_quote_data(text, fields, filename=filename)
        
        # Save to a temporary JSON file that Order Tracker can read
        temp_file = (Path(__file__).resolve().parent.parent / "ocr_import_temp.json")
        
        try:
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(vendor_data, f, indent=2)
            
            self.status_label.setText("✓ Data ready! Now open/refresh Order Tracker to import.")
            
            # Show what was extracted
            summary = "\n".join([f"{k}: {v}" for k, v in vendor_data.items() if v])
            from PyQt5.QtWidgets import QMessageBox
            QMessageBox.information(
                self,
                "Export Ready",
                f"Extracted fields saved!\n\n{summary}\n\nOpen Order Tracker and click 'Import from OCR' to load this data."
            )
            
        except Exception as e:
            self.status_label.setText(f"Export error: {str(e)}")
    
    def extract_tmcobb_line_items(self, text):
        """Extract individual line items from TMCobb/San Lorenzo quote"""
        import json
        line_items = []
        
        # TMCobb format: Line items start after "Extended" header and end at "Item Total"
        # Handle both "Extended}" / "Extended|" format and plain "Extended" at end of header line
        item_pattern = r'Extended[}\|]?\s+(.*?)\s+Item Total[^\$]*\$([\d,]+\.\d{2})'
        
        for match in re.finditer(item_pattern, text, re.DOTALL | re.IGNORECASE):
            item = {}
            section_text = match.group(1)
            item['line_total'] = match.group(2)
            
            # The first line after "Extended}" is the main description
            lines = [line.strip() for line in section_text.strip().split('\n') if line.strip()]
            
            if lines:
                # First line is the main door/product description
                item['description'] = lines[0]
                
                # Extract door size from first line (supports OCR doubled quotes).
                size_match = re.search(
                    r"(\d+\s*['’]\s*\d+\s*['\"’]{1,2}\s*[xX]\s*\d+\s*['’]\s*\d+\s*['\"’]{1,2})",
                    lines[0],
                    re.IGNORECASE,
                )
                if size_match:
                    size_clean = size_match.group(1)
                    size_clean = size_clean.replace('’', "'")
                    size_clean = re.sub(r"'{2,}", '"', size_clean)
                    size_clean = re.sub(r"\s+", " ", size_clean).strip()
                    item['size'] = size_clean
            
            # Extract jamb size from anywhere in the section (e.g., "4-9/16" Jamb" or "4-9/16"° Finger-Joint")
            # Allow for OCR artifacts like degree symbols between jamb size and keywords
            jamb_match = re.search(r'(\d+-\d+/\d+)["\']?[°\s]*(?:Jamb|Finger-Joint|Pocket)', section_text, re.IGNORECASE)
            if not jamb_match:
                # Also look for standalone jamb measurement (e.g., "4-9/16"" on its own line)
                jamb_match = re.search(r'\n\s*(\d+-\d+/\d+)["\']?\s*\n', section_text)
            if jamb_match:
                item['jamb'] = jamb_match.group(1)
            
            # Extract swing/hand (LH/RH)
            if 'left hand' in section_text.lower():
                item['swing'] = 'LH'
            elif 'right hand' in section_text.lower():
                item['swing'] = 'RH'
            
            # Extract boring type
            if 'double bore' in section_text.lower():
                item['boring'] = 'Double'
            elif 'single bore' in section_text.lower():
                item['boring'] = 'Single'
            elif 'no bore' in section_text.lower():
                item['boring'] = 'None'
            
            # Extract hinges description
            hinge_match = re.search(r'(Set of[^\n]+Hinges?)', section_text, re.IGNORECASE)
            if hinge_match:
                item['hinges'] = hinge_match.group(1).strip()
            
            # Extract color/finish (Primed, Bronze, White, etc.)
            color_match = re.search(r'(Primed|Bronze|White|Black|Almond|Tan|Clay)', section_text, re.IGNORECASE)
            if color_match:
                item['color'] = color_match.group(1)
            
            # Extract sill type
            sill_match = re.search(r'(Bronze|Aluminum|Oak|Composite|Adjustable)[^\n]*Sill', section_text, re.IGNORECASE)
            if sill_match:
                item['sill'] = sill_match.group(0).strip()
            
            # Extract glass type (look for glass descriptions)
            # Match patterns like "Divided Lite Low E Glass", "Low E Glass", "Tempered Glass", etc.
            glass_patterns = [
                r'(Divided\s+Lite[^\n]*Glass)',
                r'(Low\s*E[^\n]*Glass)',
                r'(Tempered[^\n]*Glass)',
                r'(Obscure[^\n]*Glass)',
                r'(Clear[^\n]*Glass)',
                r'(Insulated[^\n]*Glass)',
                r'(Laminated[^\n]*Glass)',
                r'(\d+\s*Lite[^\n]*Glass)',  # e.g., "15 Lite Glass"
            ]
            for pattern in glass_patterns:
                glass_match = re.search(pattern, section_text, re.IGNORECASE)
                if glass_match:
                    item['glass'] = glass_match.group(1).strip()
                    break
            
            # Detect door configuration (Slab vs Prehung)
            section_lower = section_text.lower()
            if 'prehung' in section_lower or 'pre-hung' in section_lower:
                item['door_configuration'] = 'Prehung'
            elif 'slab' in section_lower:
                item['door_configuration'] = 'Slab'
            elif 'frame' in section_lower and item.get('jamb'):
                # If it mentions "frame" and has a jamb size, it's prehung
                item['door_configuration'] = 'Prehung'
            elif item.get('jamb'):
                # If there's a jamb size but no explicit mention, likely prehung
                item['door_configuration'] = 'Prehung'
            
            # Look for quantity in first line (usually "1 536.48 $536.48" format)
            qty_match = re.search(r'^\s*(\d+)\s+[\d,]+\.\d{2}\s+\$[\d,]+\.\d{2}', lines[0] if lines else '')
            if qty_match:
                item['quantity'] = int(qty_match.group(1))
            else:
                # If not in first line, default to 1
                item['quantity'] = 1
            
            if item.get('description'):
                line_items.append(item)
        
        return json.dumps(line_items) if line_items else None
    
    def extract_milgard_line_items(self, text):
        """Extract individual line items from Milgard quote"""
        import json
        line_items = []

        MILGARD_SERIES_INDEX = 0
        MILGARD_MODEL_INDEX = 1

        def _preferred_milgard_text(raw_text: str) -> str:
            # Prefer embedded PDF text blocks when present since they are cleaner than OCR overlays.
            blocks = re.findall(
                r'---\s*Page\s*\d+\s*\(PDF Text\)\s*---\s*(.*?)(?=\n---\s*Page\s*\d+\s*\(PDF Text\)\s*---|\Z)',
                raw_text,
                re.IGNORECASE | re.DOTALL,
            )
            if blocks:
                merged = "\n".join(block.strip() for block in blocks if block and block.strip())
                if len(merged) > 400:
                    return merged
            return raw_text

        def _normalize_milgard_size(raw_size: str) -> str:
            size = str(raw_size or "")
            size = size.replace('°', '"').replace('”', '"').replace('“', '"')
            size = re.sub(r'\s+', ' ', size).strip()
            size = re.sub(r'\s*[xX]\s*', ' x ', size)

            # OCR often reads inch quotes as trailing 7 (e.g., 59 1/27, 717, 247).
            size = re.sub(r'/(\d)7(?=\s*x\s*)', r'/\1"', size)
            size = re.sub(r'/(\d)7\b', r'/\1"', size)

            # Convert first-side whole-inch OCR like 717 x ... -> 71" x ...
            # but do NOT touch valid values like 47 x ...
            size = re.sub(r'\b(\d{2,})7(?=\s*x\s*)', r'\1"', size)

            # Convert second-side whole-inch OCR like ... x 477 -> ... x 47"
            size = re.sub(r'(\s*x\s*\d{2,})7\b', r'\1"', size)

            # Ensure first side has inches mark before x when omitted.
            size = re.sub(r'^(\d{1,3}(?:\s+\d+/\d+)?)\s+x\s+', r'\1" x ', size)
            # Ensure second side keeps inches mark.
            size = re.sub(r'\s+x\s+(\d{1,3}(?:\s+\d+/\d+)?)$', r' x \1"', size)

            size = re.sub(r'"{2,}', '"', size)
            size = re.sub(r'\s+', ' ', size).strip()
            return size

        def _extract_series_model_from_location(location_text: str):
            location = str(location_text or '').strip()
            if not location:
                return '', ''
            parts = [part.strip() for part in location.split(',') if part.strip()]
            series = ''
            model = ''
            if len(parts) > MILGARD_SERIES_INDEX:
                candidate = parts[MILGARD_SERIES_INDEX]
                if re.fullmatch(r'[A-Za-z0-9]{3,8}', candidate):
                    series = candidate
            if len(parts) > MILGARD_MODEL_INDEX:
                candidate = parts[MILGARD_MODEL_INDEX]
                if re.fullmatch(r'[A-Za-z0-9]{3,8}', candidate):
                    model = candidate
            return series, model

        def _extract_line_total(section_text: str):
            """Pick the best amount after Line Total label (handles Item Total value appearing first)."""
            label_match = re.search(r'Line\s*Total\s*:\s*', section_text, re.IGNORECASE)
            if not label_match:
                return None
            tail = section_text[label_match.end():label_match.end() + 120]
            amounts = re.findall(r'\$\s*([\d,]+\.\d{2})', tail)
            if not amounts:
                return None
            if len(amounts) == 1:
                return amounts[0]
            try:
                return max(amounts, key=lambda v: float(v.replace(',', '')))
            except Exception:
                return amounts[-1]

        source_text = _preferred_milgard_text(text)

        # Parse explicit line chunks first to avoid line/location drift.
        # Milgard PDF text often uses multiline headers: Line:\nQuantity:\n<line_no>\n<qty>\nLocation:
        multiline_hits = list(re.finditer(
            r'Line\s*:\s*Quantity\s*:\s*(\d{1,3})\s*(\d{1,2})\s*Location\s*:\s*([^\n]+)',
            source_text,
            re.IGNORECASE | re.DOTALL,
        ))

        if multiline_hits:
            for idx, hit in enumerate(multiline_hits):
                next_start = multiline_hits[idx + 1].start() if idx + 1 < len(multiline_hits) else len(source_text)
                section = source_text[hit.start():next_start]
                item = {
                    'line_no': int(hit.group(1)),
                    'quantity': int(hit.group(2)),
                    'location': hit.group(3).strip(),
                }

                model_match = re.search(r'Model\s*=\s*([^\n]+)', section, re.IGNORECASE)
                if model_match:
                    item['operation'] = re.sub(r'\s+', ' ', model_match.group(1)).strip()

                handing_match = re.search(r'Handing\s*=\s*([^\n]+)', section, re.IGNORECASE)
                if handing_match:
                    item['handing'] = re.sub(r'\s+', ' ', handing_match.group(1)).strip().upper()

                finish_match = re.search(r'Ext\s+([^/\n]+)\s*/\s*Int\s+([^,\n]+)', section, re.IGNORECASE)
                if finish_match:
                    item['ext_finish'] = finish_match.group(1).strip()
                    item['int_finish'] = finish_match.group(2).strip()

                series_val, model_val = _extract_series_model_from_location(item.get('location', ''))
                if series_val:
                    item['series'] = series_val
                if model_val:
                    item['model'] = model_val

                size_match = re.search(r'(?:Size\s*=\s*)?(?:Net\s*Frame:|RO:)\s*([^\n]+)', section, re.IGNORECASE)
                if size_match:
                    item['size'] = _normalize_milgard_size(size_match.group(1))

                line_total_val = _extract_line_total(section)
                if line_total_val:
                    item['line_total'] = line_total_val

                item_total_match = re.search(r'Item\s*Total\s*:\s*\$([\d,]+\.\d{2})', section, re.IGNORECASE)
                if item_total_match:
                    item['item_total'] = item_total_match.group(1)

                line_items.append(item)

        # If we successfully parsed multiline PDF blocks, avoid OCR-style fallback parsing
        # for the same lines (it can bleed into adjacent lines and corrupt operation/price).
        use_line_hits_fallback = len(line_items) == 0
        line_hits = list(re.finditer(r'(?:\bLine\b|\bUne\b)\s*:?\s*(\d{1,3})', source_text, re.IGNORECASE)) if use_line_hits_fallback else []

        def _norm_loc(value):
            value = re.sub(r'\s+', ' ', str(value or '')).strip().lower()
            value = value.replace(' - ', '-').replace(' -', '-').replace('- ', '-')
            return value

        for idx, hit in enumerate(line_hits):
            next_start = line_hits[idx + 1].start() if idx + 1 < len(line_hits) else len(source_text)
            section = source_text[hit.start():next_start]
            item = {}
            try:
                item['line_no'] = int(hit.group(1))
            except Exception:
                pass

            # Extract location tied to this same line block.
            loc_match = re.search(r'Location\s*:\s*([^\n]+)', section, re.IGNORECASE)
            if not loc_match:
                continue
            item['location'] = loc_match.group(1).strip()

            # Quantity in the same line block only (prevents line-number bleed into qty).
            qty_match = re.search(r'Quantity\s*:?\s*(\d{1,2})\b', section[:220], re.IGNORECASE)
            if qty_match:
                try:
                    item['quantity'] = int(qty_match.group(1))
                except Exception:
                    pass
            
            # Extract series/model (e.g., "V400 Tuscany, 8621T" or "A250 Thermally...")
            series_val, model_val = _extract_series_model_from_location(item.get('location', ''))
            if series_val:
                item['series'] = series_val
            if model_val:
                item['model'] = model_val
            
            # Extract operation type (HV, DV, PW, etc)
            if 'HV' in section or 'Half Vent' in section:
                item['operation'] = 'Half Vent'
            elif 'DV' in section or 'Double Vent' in section:
                item['operation'] = 'Double Vent'
            elif 'PW' in section or 'Picture' in section:
                item['operation'] = 'Picture'
            elif 'SD2' in section or 'Sliding Door Two Panel' in section:
                item['operation'] = 'Sliding Door Two Panel'
            elif 'Trapezoid' in section:
                item['operation'] = 'Trapezoid'
            
            # Extract size (Net Frame or RO)
            size_match = re.search(r'(?:Size\s*=\s*)?(?:Net\s*Frame:|RO:)\s*([0-9 /"\'\-xX°]+)', section, re.IGNORECASE)
            if size_match:
                item['size'] = _normalize_milgard_size(size_match.group(1))

            # Extract handing when present
            handing_match = re.search(r'Handing\s*=\s*([^\n]+)', section, re.IGNORECASE)
            if handing_match:
                item['handing'] = re.sub(r'\s+', ' ', handing_match.group(1)).strip().upper()
            
            # Extract finishes
            finish_match = re.search(r'Ext\s+(\w+)\s*/\s*Int\s+(\w+)', section, re.IGNORECASE)
            if finish_match:
                item['ext_finish'] = finish_match.group(1)
                item['int_finish'] = finish_match.group(2)
            
            # Extract line total
            line_total_val = _extract_line_total(section)
            if line_total_val:
                item['line_total'] = line_total_val

            # Extract item total (used for quantity sanity checks)
            item_total_match = re.search(r'Item Total:\s*\$([\d,]+\.\d{2})', section, re.IGNORECASE)
            if item_total_match:
                item['item_total'] = item_total_match.group(1)
            
            # If quantity still missing, infer from line/item totals when available.
            if not item.get('quantity'):
                item_total_match = re.search(r'Item Total:\s*\$([\d,]+\.\d{2})', section, re.IGNORECASE)
                if item_total_match and item.get('line_total'):
                    try:
                        line_total = float(str(item['line_total']).replace(',', ''))
                        item_total = float(item_total_match.group(1).replace(',', ''))
                        if item_total > 0:
                            q = int(round(line_total / item_total))
                            if q >= 1 and abs((line_total / item_total) - q) < 0.06:
                                item['quantity'] = q
                    except Exception:
                        pass

            if not item.get('quantity'):
                item['quantity'] = 1

            # Only add if we found meaningful data.
            if item.get('location'):
                line_items.append(item)

        # Fallback for documents where line markers are badly damaged: parse by location blocks.
        # Only run this fallback if NO items were found (to avoid duplicates from OCR sections)
        if len(line_items) == 0:
            location_hits = list(re.finditer(r'Location\s*:\s*([^\n]+)', source_text, re.IGNORECASE))
            for idx, hit in enumerate(location_hits):
                next_start = location_hits[idx + 1].start() if idx + 1 < len(location_hits) else len(source_text)
                section = source_text[hit.start():next_start]
                location_text = hit.group(1).strip()
                
                # Skip obviously invalid locations (OCR artifacts, headers, prices)
                if not location_text or len(location_text) < 5:
                    continue
                if location_text.startswith('$') or re.match(r'^\d+\s*$', location_text):
                    continue  # Skip standalone prices or numbers
                if re.match(r'^(Quantity|Line|Une|Total|Item|Price)\s*:', location_text, re.IGNORECASE):
                    continue  # Skip header lines
                
                item = {'location': location_text, 'quantity': 1}
                size_match = re.search(r'(?:Size\s*=\s*)?(?:Net\s*Frame:|RO:)\s*([0-9 /"\'\-xX°]+)', section, re.IGNORECASE)
                if size_match:
                    item['size'] = _normalize_milgard_size(size_match.group(1))
                total_match = re.search(r'Line Total:\s*\$([\d,]+\.\d{2})', section, re.IGNORECASE)
                if total_match:
                    item['line_total'] = total_match.group(1)
                line_items.append(item)

        # Backfill missing sizes from same line_no blocks in preferred text.
        if line_items:
            for item in line_items:
                if item.get('size') or item.get('line_no') is None:
                    continue
                line_no = item.get('line_no')
                block_match = re.search(
                    rf'(?:Line|Une)\s*:?\s*{line_no}\b(.*?)(?=(?:Line|Une)\s*:?\s*\d+\b|\Z)',
                    source_text,
                    re.IGNORECASE | re.DOTALL,
                )
                if not block_match:
                    continue
                size_match = re.search(r'(?:Size\s*=\s*)?(?:Net\s*Frame:|RO:)\s*([^\n]+)', block_match.group(1), re.IGNORECASE)
                if size_match:
                    item['size'] = _normalize_milgard_size(size_match.group(1))

        def _score(it):
            score = 0
            if it.get('line_no') is not None:
                score += 5
            if it.get('location'):
                score += 3
            if it.get('size'):
                score += 3
            if it.get('line_total'):
                score += 3
            if it.get('series'):
                score += 2
            if it.get('model'):
                score += 2
            if it.get('operation'):
                score += 1
            if it.get('handing'):
                score += 1
            if it.get('quantity'):
                score += 1
            return score

        # First collapse exact duplicates by rich signature.
        rich_seen = set()
        rich_deduped = []
        for item in line_items:
            sig = (
                item.get('line_no'),
                _norm_loc(item.get('location')),
                re.sub(r'\s+', ' ', str(item.get('size') or '')).strip().lower(),
                re.sub(r'\s+', ' ', str(item.get('model') or '')).strip().lower(),
                re.sub(r'\s+', ' ', str(item.get('line_total') or '')).strip().lower(),
            )
            if sig in rich_seen:
                continue
            rich_seen.add(sig)
            rich_deduped.append(item)

        # Keep one best item per line number.
        by_line = {}
        for item in rich_deduped:
            line_no = item.get('line_no')
            if line_no is None:
                continue
            current = by_line.get(line_no)
            if current is None or _score(item) > _score(current):
                by_line[line_no] = item

        with_line = list(by_line.values())
        with_line_keys = {
            (
                _norm_loc(it.get('location')),
                re.sub(r'\s+', ' ', str(it.get('size') or '')).strip().lower(),
                re.sub(r'\s+', ' ', str(it.get('line_total') or '')).strip().lower(),
            )
            for it in with_line
        }

        # If numbered coverage is good, skip no-line fallbacks to avoid OCR/PDF duplicates.
        keep_no_line_fallback = len(with_line) < 10
        if keep_no_line_fallback:
            for item in rich_deduped:
                if item.get('line_no') is not None:
                    continue
                key = (
                    _norm_loc(item.get('location')),
                    re.sub(r'\s+', ' ', str(item.get('size') or '')).strip().lower(),
                    re.sub(r'\s+', ' ', str(item.get('line_total') or '')).strip().lower(),
                )
                if key in with_line_keys:
                    continue
                with_line.append(item)

        line_items = sorted(with_line, key=lambda it: (it.get('line_no', 9999), it.get('location', '')))

        # Expand combined location lines like "IB IC" with quantity 2 into separate rows.
        expanded_items = []
        for item in line_items:
            location = str(item.get('location') or '').strip()
            quantity = int(item.get('quantity') or 1)
            item_total_val = None
            line_total_val = None
            try:
                if item.get('item_total'):
                    item_total_val = float(str(item.get('item_total')).replace(',', ''))
            except Exception:
                item_total_val = None
            try:
                if item.get('line_total'):
                    line_total_val = float(str(item.get('line_total')).replace(',', ''))
            except Exception:
                line_total_val = None

            # Capture compact location codes (IA/IB/IC/ID...) and split only when it matches qty.
            location_tokens = re.findall(r'\bI[A-Z]\b', location.upper())
            if location_tokens and len(location_tokens) >= 2 and len(location_tokens) == quantity:
                for token in location_tokens:
                    clone = dict(item)
                    clone['location'] = token
                    clone['quantity'] = 1

                    # Per-unit line total should match item total when present.
                    if item_total_val is not None:
                        clone['line_total'] = f"{item_total_val:.2f}"
                    elif line_total_val is not None and quantity > 0:
                        clone['line_total'] = f"{(line_total_val / quantity):.2f}"

                    expanded_items.append(clone)
            else:
                expanded_items.append(item)

        line_items = expanded_items

        return json.dumps(line_items) if line_items else None
    
    def extract_orepac_line_items(self, text):
        """Extract individual line items from OrePac quote"""
        import json
        line_items = []

        def _norm(v):
            return re.sub(r'\s+', ' ', str(v or '')).strip().lower()

        def _clean_text(v):
            cleaned = re.sub(r'\s+', ' ', str(v or '')).strip()
            cleaned = re.sub(
                r'\s+Page\s+\d+\s+of\s+\d+\s+\d{2}/\d{2}/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M\s+Quote:\s*\d+\s*$',
                '',
                cleaned,
                flags=re.IGNORECASE,
            )
            return cleaned.strip()

        def _normalize_inches(v):
            text_value = str(v or '').strip()
            # OCR sometimes drops the space in e.g. "4 9/16"" -> "49/16"".
            # Jamb widths in these quotes are always a single-digit whole
            # inch count (4", 5", 6"...), so a lone leading digit fused
            # directly to a fraction is safe to re-split.
            fused_match = re.match(r'^(\d)(\d+/\d+)"?$', text_value)
            if fused_match:
                text_value = f'{fused_match.group(1)} {fused_match.group(2)}'
            if text_value and not text_value.endswith('"') and re.search(r'^\d+[\s\-]\d+/\d+$', text_value):
                text_value = f'{text_value}"'
            return re.sub(r'^(\d+)\s+(\d+/\d+")$', r'\1-\2', text_value)

        def _extract_two_value_measure(section_text, label):
            match = re.search(
                rf'{label}\s+(\d+(?:\s+\d+/\d+)?")\s+(\d+(?:\s+\d+/\d+)?")',
                section_text,
                re.IGNORECASE,
            )
            if not match:
                return None
            first = re.sub(r'\s+', ' ', match.group(1)).strip()
            second = re.sub(r'\s+', ' ', match.group(2)).strip()
            return f"{first} x {second}"

        def _merge_item(base, incoming):
            # Fill missing/weak fields on base from incoming duplicate
            merged = dict(base)
            for key, value in incoming.items():
                if not value:
                    continue
                existing = merged.get(key)
                if not existing:
                    merged[key] = value
                    continue
                # Prefer value with more structure/details
                if len(str(value).strip()) > len(str(existing).strip()):
                    merged[key] = value
            return merged

        # Prefer only the clean PDF-text blocks (marked "--- Page N (PDF Text) ---").
        # This avoids parsing the same item 2-3 times from noisy OCR layers.
        pdf_text_blocks = re.findall(
            r'---\s*Page\s+\d+\s+\(PDF Text\)\s*---\s*(.*?)(?=---\s*Page\s+\d+|$)',
            text,
            re.DOTALL | re.IGNORECASE,
        )
        parse_text = '\n'.join(pdf_text_blocks) if pdf_text_blocks else text

        # OrePac format has "Item Price:" and "Item Total:" for each product
        # Split by "Product Type" to get individual items
        item_sections = re.split(r'Product Type\s+', parse_text)[1:]  # Skip before first "Product Type"

        addon_items = []

        addon_match = re.search(
            r'Quote Add-Ons\s+.*?Add-On Description[^\n]*\n(.*?)Add-On Total:',
            parse_text,
            re.DOTALL | re.IGNORECASE,
        )
        if addon_match:
            addon_section = addon_match.group(1)
            addon_pattern = re.compile(
                r'([^\n$]+(?:\n(?!\$|Add-On Total:)[^\n$]+)*)\s+\$\s*([\d,]+\.\d{2})\s+(\d+)\s+\$\s*([\d,]+\.\d{2})',
                re.IGNORECASE,
            )
            for match in addon_pattern.finditer(addon_section):
                desc = _clean_text(match.group(1)).replace(' FP', '').strip()
                desc = re.sub(r'^Price\s+Qty\s+Total\s+', '', desc, flags=re.IGNORECASE)
                if not desc:
                    continue
                addon_items.append({
                    'product_type': 'Add-On',
                    'description': desc,
                    'item_price': match.group(2),
                    'quantity': int(match.group(3)),
                    'line_total': match.group(4),
                })
        
        for section in item_sections:
            item = {}
            
            # Extract Product Type
            type_match = re.search(r'^([^\n]+)', section)
            if type_match:
                item['product_type'] = type_match.group(1).strip()
            
            # Extract Product Line
            line_match = re.search(r'Product Line\s+([^\n]+)', section, re.IGNORECASE)
            if line_match:
                item['product_line'] = line_match.group(1).strip()
            
            # Extract Door Configuration
            config_match = re.search(r'Door Configuration\s+([^\n]+)', section, re.IGNORECASE)
            if config_match:
                config_value = config_match.group(1).strip()
                if 'slab' in config_value.lower():
                    item['door_configuration'] = 'Slab'
                elif 'prehung' in config_value.lower():
                    item['door_configuration'] = 'Prehung'
                else:
                    item['door_configuration'] = config_value

            item_block_match = re.search(r'\bItem\s+\d+\s*\n(.*?)\nSize\b', section, re.IGNORECASE | re.DOTALL)
            if item_block_match:
                candidate_lines = [ln.strip() for ln in item_block_match.group(1).split('\n') if ln.strip()]
                # Drop the lead-time annotation (e.g. "*(5-7 days)") that always
                # follows the "Item N" heading - it's not a meaningful label.
                candidate_lines = [
                    ln for ln in candidate_lines
                    if not re.match(r'^\*?\(\s*\d+\s*-\s*\d+\s*days?\s*\)\s*$', ln, re.IGNORECASE)
                ]
                if candidate_lines and candidate_lines[0].lower() != 'size':
                    item['special_conditions'] = candidate_lines[0]
            
            # Extract Door Width and Height
            width_match = re.search(r'Door Width\s+(\d+/\d+)', section, re.IGNORECASE)
            height_match = re.search(r'Door Height\s+(\d+/\d+)', section, re.IGNORECASE)
            if width_match and height_match:
                item['size'] = f"{width_match.group(1)} x {height_match.group(1)}"
            
            # Extract Door Style
            style_match = re.search(r'Door Style\s+([^\n]+)', section, re.IGNORECASE)
            if style_match:
                item['door_style'] = style_match.group(1).strip()
            
            # Extract Wood Species (maps to color/finish for the editor)
            species_match = re.search(r'Wood Species\s+([^\n]+)', section, re.IGNORECASE)
            if species_match:
                item['color'] = species_match.group(1).strip()
            
            # Extract Door Thickness
            thickness_match = re.search(r'Door Thickness\s+([\d\s/]+["\']?)', section, re.IGNORECASE)
            if thickness_match:
                item['thickness'] = thickness_match.group(1).strip()
            
            # Extract Model Number (wood doors) or Style Number (Therma-Tru
            # fiberglass/steel doors use "Style Number" instead of "Model Number").
            model_match = re.search(r'Model Number\s+([^\n]+)', section, re.IGNORECASE)
            if model_match:
                item['model'] = model_match.group(1).strip()
            else:
                style_number_match = re.search(r'Style Number\s+([^\n]+)', section, re.IGNORECASE)
                if style_number_match:
                    item['model'] = style_number_match.group(1).strip()

            # Extract Door Bore (maps to boring for the editor)
            bore_match = re.search(r'Door Bore\s+([^\n]+)', section, re.IGNORECASE)
            if bore_match:
                item['boring'] = bore_match.group(1).strip()

            lock_match = re.search(r'Lock System Type\s+([^\n]+)', section, re.IGNORECASE)
            if lock_match:
                item['hardware'] = lock_match.group(1).strip()

            # Extract Bore Location
            bore_loc_match = re.search(r'Bore Location\s+([^\n]+)', section, re.IGNORECASE)
            if bore_loc_match:
                item['bore_location'] = bore_loc_match.group(1).strip()

            # Extract Jamb size if listed as a dedicated field
            jamb_field_match = re.search(r'Jamb\s+(?:Depth|Width)\s+([^\n]+)', section, re.IGNORECASE)
            if jamb_field_match:
                item['jamb'] = _normalize_inches(jamb_field_match.group(1))

            rough_opening = _extract_two_value_measure(section, 'Rough Opening')
            if rough_opening:
                item['rough_opening'] = rough_opening

            finished_opening = _extract_two_value_measure(section, 'Finished Opening')
            if finished_opening:
                item['finished_opening'] = finished_opening

            hinge_finish_match = re.search(r'Hinge Finish\s+([^\n]+)', section, re.IGNORECASE)
            hinge_type_match = re.search(r'Hinge Type\s+([^\n]+)', section, re.IGNORECASE)
            hinge_shape_match = re.search(r'Hinge Shape\s+([^\n]+)', section, re.IGNORECASE)
            hinge_parts = [
                part.strip()
                for part in [
                    hinge_finish_match.group(1) if hinge_finish_match else '',
                    hinge_shape_match.group(1) if hinge_shape_match else '',
                    hinge_type_match.group(1) if hinge_type_match else '',
                ]
                if part and str(part).strip()
            ]
            if hinge_parts:
                item['hinges'] = ' '.join(hinge_parts).strip()
                if not item['hinges'].lower().endswith('hinges'):
                    item['hinges'] = f"{item['hinges']} Hinges"
            
            # Extract Item Price
            price_match = re.search(r'Item Price:\s*\$([\d,]+\.\d{2})', section, re.IGNORECASE)
            if price_match:
                item['item_price'] = price_match.group(1)
            
            # Extract Quantity
            qty_match = re.search(r'Quantity:\s*(\d+)', section, re.IGNORECASE)
            if qty_match:
                item['quantity'] = int(qty_match.group(1))
            else:
                item['quantity'] = 1
            
            # Extract Item Total
            total_match = re.search(r'Item Total:\s*\$([\d,]+\.\d{2})', section, re.IGNORECASE)
            if total_match:
                item['line_total'] = total_match.group(1)
            
            # Also extract the Item N label so UI shows the correct item number
            item_num_match = re.search(r'\bItem\s+(\d+)\b', section, re.IGNORECASE)
            if item_num_match:
                item['item_number'] = int(item_num_match.group(1))

            # Extract handing (maps to swing for the editor)
            handing_match = re.search(r'Door Handing\s+([^\n]+)', section, re.IGNORECASE)
            if handing_match:
                item['swing'] = handing_match.group(1).strip()

            # Capture full multi-line vendor description (up to next labelled field or price)
            long_desc_match = re.search(
                r'Vendor Item Descri[^\n]*\n(.*?)(?:Item Price:|WARNING:|\Z)',
                section, re.DOTALL | re.IGNORECASE
            )
            if long_desc_match:
                raw_desc = _clean_text(long_desc_match.group(1))
                if raw_desc:
                    item['description'] = raw_desc

            # Extract jamb size from description if not already found as a dedicated field
            # Pattern: "4 9/16" Primed Applied Stop Jamb" or "4-9/16" Applied Stop Jamb"
            if not item.get('jamb') and item.get('description'):
                jamb_desc_m = re.search(
                    r'(\d+[\s\-]\d+/\d+\")\s+\w+(?:\s+\w+)*?\s+Applied Stop Jamb',
                    item['description'], re.IGNORECASE
                )
                if jamb_desc_m:
                    item['jamb'] = _normalize_inches(jamb_desc_m.group(1))

            # Extract hinges from description if not already found
            # Pattern: text after "Applied Stop Jamb -" stopping before any page/date trailer
            if not item.get('hinges') and item.get('description'):
                hinge_desc_m = re.search(
                    r'Applied Stop Jamb\s*[-\u2013]\s*(.+?)(?=\s+Page\s+\d+|\s+Lead Time:|\Z)',
                    item['description'], re.IGNORECASE
                )
                if hinge_desc_m:
                    item['hinges'] = hinge_desc_m.group(1).strip()

            # Only add if we found meaningful data
            if item.get('product_type') or item.get('description'):
                line_items.append(item)

        for addon_item in addon_items:
            desc_norm = _norm(addon_item.get('description'))
            jamb_match = re.search(r'(\d+[\s\-]\d+/\d+"?)', addon_item.get('description', ''), re.IGNORECASE)
            jamb_size = _normalize_inches(jamb_match.group(1)) if jamb_match else ''

            target = None
            if 'bypass jamb' in desc_norm:
                target = next(
                    (
                        item for item in line_items
                        if item.get('item_number') == 1
                        or 'bypass' in _norm(item.get('special_conditions'))
                    ),
                    None,
                )
                if target:
                    if jamb_size and not target.get('jamb'):
                        target['jamb'] = jamb_size
                    hardware_match = re.search(r'Jamb\s+w/\s*(.+)$', addon_item.get('description', ''), re.IGNORECASE)
                    if hardware_match:
                        target['hardware'] = hardware_match.group(1).strip()
            elif 'bifold' in desc_norm:
                target = next(
                    (
                        item for item in line_items
                        if 'bifold' in _norm(item.get('door_configuration'))
                        or 'bifold' in _norm(item.get('description'))
                        or 'bf' in _norm(item.get('model'))
                    ),
                    None,
                )
                if target and jamb_size and not target.get('jamb'):
                    target['jamb'] = jamb_size

            if target:
                existing_notes = target.get('special_conditions', '')
                note_text = addon_item.get('description', '').strip()
                if note_text and note_text not in existing_notes:
                    target['special_conditions'] = (
                        f"{existing_notes}; {note_text}".strip('; ')
                        if existing_notes
                        else note_text
                    )
            else:
                line_items.append(addon_item)

        return json.dumps(line_items) if line_items else None
    
    def extract_as400_line_items(self, text):
        """Extract individual line items from AS400 San Lorenzo special order"""
        import json
        line_items = []
        
        # AS400 format has line numbers followed by product codes and descriptions
        # Format: line# | product_code | description | qty | price | total
        # Example: "1 2 5212.HL0.US15 24358) g1717 138-61 EA W104"
        #          "2 | | 1LH, 1 RH | | |"
        
        # Try to extract structured line items
        # Look for lines that start with a number and have product codes
        item_pattern = r'(\d+)\s+\d+\s+([\w.]+)\s+.*?\s+([\d.]+)\s*EA'
        
        for match in re.finditer(item_pattern, text):
            item = {}
            item['line_number'] = match.group(1)
            item['product_code'] = match.group(2)
            item['unit_price'] = match.group(3)
            
            # Try to find the description on following lines
            # Look for the area around this match
            start_pos = match.start()
            end_pos = match.end()
            
            # Get a chunk of text around this item
            context = text[start_pos:end_pos + 200]
            
            # Extract quantity/hand info (1LH, 1RH, etc.)
            hand_match = re.search(r'(\d+\s*LH,?\s*\d+\s*RH|\d+\s*RH,?\s*\d+\s*LH|\d+\s*LH|\d+\s*RH)', context, re.IGNORECASE)
            if hand_match:
                item['hand'] = hand_match.group(1).strip()
                # Extract quantity
                qty_matches = re.findall(r'(\d+)', hand_match.group(1))
                if qty_matches:
                    item['quantity'] = sum(int(q) for q in qty_matches)
            else:
                item['quantity'] = 1
            
            # Try to find product description (like "EMTEK DOOR HANDLES")
            desc_match = re.search(r'([A-Z][A-Z\s]+(?:DOOR|HANDLE|HARDWARE|WINDOW|JAMB|HINGE)[A-Z\s]*)', text[:start_pos][::-1])
            if desc_match:
                # Reverse it back since we searched backwards
                item['description'] = desc_match.group(1)[::-1].strip()
            
            # Calculate line total
            try:
                if item.get('quantity') and item.get('unit_price'):
                    unit_price = float(item['unit_price'].replace(',', ''))
                    line_total = unit_price * item['quantity']
                    item['line_total'] = f"{line_total:.2f}"
            except:
                pass
            
            if item.get('product_code'):
                line_items.append(item)
        
        # If structured extraction didn't work, try a simpler approach
        if not line_items:
            # Look for product descriptions and prices
            simple_pattern = r'([A-Z][A-Z\s]+(?:DOOR|HANDLE|HARDWARE|WINDOW)[A-Z\s]*):?.*?\$([\d,]+\.\d{2})'
            for match in re.finditer(simple_pattern, text):
                item = {
                    'description': match.group(1).strip(),
                    'unit_price': match.group(2),
                    'quantity': 1,
                    'line_total': match.group(2)
                }
                line_items.append(item)
        
        return json.dumps(line_items) if line_items else None

    def extract_as400_screen_line_items(self, text):
        """Extract line items from AS400 Order Inquiry screen text"""
        import json
        line_items = []

        def extract_size_from_description(description: str):
            # Match formats like "2/4 6/8" or "2/6 6/8"
            size_match = re.search(r'\b(\d{1,2})\/(\d{1,2})\s+(\d{1,2})\/(\d{1,2})\b', description)
            if size_match:
                return f"{size_match.group(1)}/{size_match.group(2)} x {size_match.group(3)}/{size_match.group(4)}"

            # Match compact formats like "2468" (2/4 x 6/8) or "3068" (3/0 x 6/8)
            compact_match = re.search(r'\b(\d)(\d)68\b', description)
            if compact_match:
                return f"{compact_match.group(1)}/{compact_match.group(2)} x 6/8"

            return ''

        # Find the section after the header row
        header_match = re.search(r'Description\s+Qty\s+Retail\s+Pr\.\s+U/M\s+Ftg\s+Total\s*\$\s+Dsc%', text, re.IGNORECASE)
        if not header_match:
            return None

        block = text[header_match.end():]
        lines = block.splitlines()
        item_line_pattern = re.compile(r'^(.*?)\s+(\d+)\s+([\d,]+[\.,]\d{2})\s+EA\s+([\d,]+[\.,]\d{2})\s*$', re.IGNORECASE)

        for line in lines:
            line = line.strip()
            if not line:
                continue
            lower_line = line.lower()
            if lower_line.startswith('sub tot') or lower_line.startswith('xxx department') or lower_line.startswith('more...'):
                break

            normalized_line = line.replace(',', '.')
            item_match = item_line_pattern.search(normalized_line)
            if item_match:
                item = {
                    'description': line[:item_match.start(2)].strip(),
                    'quantity': int(item_match.group(2)),
                    'unit_price': item_match.group(3).replace(',', '').replace(' ', ''),
                    'line_total': item_match.group(4).replace(',', '').replace(' ', '')
                }
                size_value = extract_size_from_description(item['description'])
                if size_value:
                    item['size'] = size_value
                line_items.append(item)
                continue

            # If the line contains a qty/price pattern later, treat as a new item even if description is broken
            embedded_match = re.search(r'(\d+)\s+([\d,]+[\.,]\d{2})\s+EA\s+([\d,]+[\.,]\d{2})', normalized_line, re.IGNORECASE)
            if embedded_match:
                # Try to split description from the first qty occurrence
                split_index = embedded_match.start()
                description = line[:split_index].strip()
                item = {
                    'description': description,
                    'quantity': int(embedded_match.group(1)),
                    'unit_price': embedded_match.group(2).replace(',', '').replace(' ', ''),
                    'line_total': embedded_match.group(3).replace(',', '').replace(' ', '')
                }
                size_value = extract_size_from_description(item['description'])
                if size_value:
                    item['size'] = size_value
                line_items.append(item)
                continue

            # Continuation lines (e.g., TRIM 2/4 HEIGHT BY 1/8)
            if line_items and ' EA ' not in line:
                line_items[-1]['description'] = f"{line_items[-1]['description']} {line}".strip()
                if not line_items[-1].get('size'):
                    size_value = extract_size_from_description(line_items[-1]['description'])
                    if size_value:
                        line_items[-1]['size'] = size_value

        return json.dumps(line_items) if line_items else None

    def extract_schedule_line_items(self, text):
        """Extract door/window schedule line items from architectural plans"""
        import json
        line_items = []

        text_lower = text.lower()
        if 'door schedule' in text_lower:
            line_items.extend(self.extract_schedule_block_items(text, schedule_type='Door', tag_prefix='D'))

        if 'window schedule' in text_lower:
            line_items.extend(self.extract_schedule_block_items(text, schedule_type='Window', tag_prefix='W'))

        return json.dumps(line_items) if line_items else None

    def extract_schedule_block_items(self, text, schedule_type, tag_prefix):
        """Parse a specific schedule block into line items"""
        items = []
        start_marker = f"{schedule_type.lower()} schedule"
        start_index = text.lower().find(start_marker)
        if start_index == -1:
            return items

        block = text[start_index:start_index + 6000]

        stop_markers = [
            'drawing title', 'sheet number', 'scale:', 'project number',
            'issue / revision', 'legend', 'gyp. board', 'insulation',
            'c stud', 'blocking as req', 'door jamb', 'door header',
            'sidelite jamb', 'sidelite header'
        ]

        other_marker = 'window schedule' if schedule_type.lower() == 'door' else 'door schedule'
        other_pos = block.lower().find(other_marker)
        if other_pos != -1:
            block = block[:other_pos]

        for marker in stop_markers:
            marker_pos = block.lower().find(marker)
            if marker_pos != -1:
                block = block[:marker_pos]
                break

        normalized = re.sub(r'(?i)(door schedule|window schedule)', r'\1\n', block)
        normalized = re.sub(rf'(?i)({tag_prefix}\s*[-]?\s*\d{{1,2}})', r'\n\1', normalized)

        lines = [line.strip() for line in normalized.splitlines() if line.strip()]
        current = None
        header_keywords = ['symbol', 'manufacturer', 'product', 'model', 'material', 'finish', 'size', 'hardware']

        for line in lines:
            tag_match = re.match(rf'^{tag_prefix}\s*[-]?\s*(\d{{1,2}})\b', line, re.IGNORECASE)
            if tag_match:
                if current:
                    items.append(current)
                tag_value = f"{tag_prefix.upper()}-{tag_match.group(1).zfill(2)}"
                current = {
                    'schedule_type': schedule_type,
                    'symbol': tag_value
                }
                remainder = line[tag_match.end():].strip()
                if remainder:
                    current['description'] = remainder
                continue

            if current is None:
                lower_line = line.lower()
                if any(keyword in lower_line for keyword in header_keywords):
                    continue
                continue

            current['description'] = f"{current.get('description', '')} {line}".strip()

        if current:
            items.append(current)

        size_patterns = [
            r'(\d{1,2}\'-\d{1,2}(?:\.\d+)?"?\s*[xX]\s*\d{1,2}\'-\d{1,2}(?:\.\d+)?"?)',
            r'(\d{1,2}\'-\d{1,2}(?:\.\d+)?"?\s*[xX]\s*\d{1,2}\'-?\d{1,2}(?:\.\d+)?"?)'
        ]
        detail_markers = [
            'gyp. board', 'insulation', 'c stud', 'blocking as req',
            'door jamb', 'door header', 'sidelite jamb', 'sidelite header',
            'aluminum frame', 'rabbet with silicone gasket'
        ]

        for item in items:
            original_description = item.get('description', '')
            description = original_description
            if description:
                for marker in detail_markers:
                    marker_pos = description.lower().find(marker)
                    if marker_pos != -1:
                        description = description[:marker_pos].strip()
                        break

            size_candidates = []
            for pattern in size_patterns:
                size_candidates.extend(re.findall(pattern, original_description, re.IGNORECASE))
                size_match = re.search(pattern, description, re.IGNORECASE)
                if size_match:
                    item['size'] = size_match.group(1).replace('  ', ' ').strip()
                    break

            if description:
                for pattern in size_patterns:
                    description = re.sub(pattern, '', description, flags=re.IGNORECASE)
                description = re.sub(r'\bN/A\b', '', description, flags=re.IGNORECASE)
                description = re.sub(r'\bVARIES\b', '', description, flags=re.IGNORECASE)
                description = re.sub(r'\b\d+(?:/\d+)?"?\b', '', description)
                description = re.sub(r'\b([A-Z]+)(\s+\1)+\b', r'\1', description, flags=re.IGNORECASE)
                description = re.sub(r'\b([A-Z]+\s+[A-Z]+)(\s+\1)+\b', r'\1', description, flags=re.IGNORECASE)
                description = re.sub(r'\b(CARD READER)(\s+CARD READER)+\b', r'\1', description, flags=re.IGNORECASE)
                description = re.sub(r'["“”]+', '', description)
                description = re.sub(r'\s{2,}', ' ', description).strip()
                item['description'] = description

            if size_candidates:
                item['_size_candidates'] = size_candidates

            hardware_matches = re.findall(r'(CARD READER|PANIC BAR|LEVER|HINGES?|CLOSER|LOCKSET|DEADBOLT)', description, re.IGNORECASE)
            if hardware_matches:
                unique_hardware = sorted({match.upper() for match in hardware_matches})
                item['hardware'] = ', '.join(unique_hardware).title()

        # If descriptions are missing (collapsed table text), share base description
        non_empty_descriptions = [item.get('description', '') for item in items if item.get('description')]
        base_description = ''
        if non_empty_descriptions:
            base_description = non_empty_descriptions[0]
            for pattern in size_patterns:
                base_description = re.sub(pattern, '', base_description, flags=re.IGNORECASE)
            base_description = re.sub(r'\s{2,}', ' ', base_description).strip()

        if base_description:
            for item in items:
                if not item.get('description'):
                    item['description'] = base_description

        # Distribute multiple sizes across tags when text collapses into a single line
        all_sizes = []
        for item in items:
            if item.get('_size_candidates'):
                all_sizes.extend(item.get('_size_candidates'))
            item.pop('_size_candidates', None)

        if all_sizes:
            if len(all_sizes) >= len(items):
                for idx, item in enumerate(items):
                    item['size'] = all_sizes[idx]
            else:
                size_iter = iter(all_sizes)
                for item in items:
                    if not item.get('size'):
                        try:
                            item['size'] = next(size_iter)
                        except StopIteration:
                            break

        return items
    
    def parse_filename_metadata(self, filename):
        """Extract metadata from standardized filename format:
        Firstname_lastname_vendor_product_mm-dd-yyyy_quote.pdf
        Example: Trevor_Jones_TMCobb_Doors_12-03-2025_quote.pdf
        """
        metadata = {}
        
        try:
            # Remove file extension
            name = Path(filename).stem
            
            # Split by underscores
            parts = name.split('_')
            
            if len(parts) >= 5:
                # Extract customer name (first and last)
                first_name = parts[0].replace('-', ' ').title()
                last_name = parts[1].replace('-', ' ').title()
                metadata['customer_name'] = f"{first_name} {last_name}"
                
                # Extract vendor
                vendor = parts[2]
                # Normalize vendor names
                if 'tmcobb' in vendor.lower() or 'cobb' in vendor.lower():
                    metadata['vendor'] = 'TMCobb'
                elif 'milgard' in vendor.lower():
                    metadata['vendor'] = 'Milgard'
                elif 'sanlorenzo' in vendor.lower() or 'lorenzo' in vendor.lower():
                    metadata['vendor'] = 'San Lorenzo'
                else:
                    metadata['vendor'] = vendor.title()
                
                # Extract product type
                product = parts[3].lower()
                if 'door' in product:
                    metadata['product_type'] = 'Door'
                elif 'window' in product:
                    metadata['product_type'] = 'Window'
                
                # Extract date (mm-dd-yyyy format)
                date_str = parts[4]
                try:
                    # Parse mm-dd-yyyy
                    date_parts = date_str.split('-')
                    if len(date_parts) == 3:
                        month, day, year = date_parts
                        # Convert to MM/DD/YYYY format for consistency
                        metadata['quote_date'] = f"{month.zfill(2)}/{day.zfill(2)}/{year}"
                except:
                    pass

                # Extract document type (quote, invoice, signoff, costsheet, SOA)
                if len(parts) >= 6:
                    doc_type = parts[5].strip().lower()
                    if doc_type in ('quote', 'invoice', 'signoff', 'costsheet'):
                        metadata['document_type'] = doc_type
                    elif doc_type == 'soa':
                        metadata['document_type'] = 'SOA'
                
        except Exception as e:
            print(f"Could not parse filename metadata: {e}")
        
        return metadata

    def _normalize_po_number(self, value: str) -> str:
        """Return normalized PO only if it matches required formats: 55-55555 or 55-55555TA."""
        if not value:
            return ""

        cleaned = re.sub(r'\s+', '', str(value)).upper()
        match = re.search(r'\b(\d{2}-\d{5}(?:TA)?)\b', cleaned)
        return match.group(1) if match else ""
    
    def extract_vendor_quote_data(self, text, base_fields, filename=None, pre_selected_vendor=None):
        """Extract detailed vendor quote information
        
        Args:
            text: The OCR extracted text
            base_fields: Basic extracted fields
            filename: Optional filename for metadata extraction
            pre_selected_vendor: Pre-selected vendor name (overrides auto-detection)
        """
        data = {
            'customer_name': '',
            'phone': '',
            'email': '',
            'quote_number': '',
            'quote_date': '',
            'quote_total': '',
            'po_number': '',
            'customer_number': '',
            'vendor': '',
            'product_type': '',
            'series': '',
            'operation_style': '',
            'exterior_finish': '',
            'interior_finish': '',
            'size': '',
            'glass': '',
            'hardware': '',
            'door_configuration': '',
            'document_type': '',
            'line_items': '',
            'schedule_items': '',
        }
        
        # Parse filename first if available
        filename_data = {}
        if filename:
            filename_data = self.parse_filename_metadata(filename)
            print(f"Parsed from filename: {filename_data}")
        
        # Use pre-selected vendor if provided, otherwise detect from text
        text_lower = text.lower()
        
        if pre_selected_vendor:
            print(f"Using pre-selected vendor: {pre_selected_vendor}")
            # Map UI vendor names to detection logic
            if pre_selected_vendor == "Andersen":
                is_schedule = False
                is_milgard = False
                is_as400 = False
                is_as400_screen = False
                # Andersen will be detected through product name later
            elif pre_selected_vendor == "Milgard":
                is_schedule = False
                is_milgard = True
                is_as400 = False
                is_as400_screen = False
            elif pre_selected_vendor == "San Lorenzo":
                is_schedule = False
                is_milgard = False
                # Check which San Lorenzo format
                is_as400_screen = ('order inquiry' in text_lower or 'order #' in text_lower)
                is_as400 = not is_as400_screen  # Default to AS400 form if not screen
            elif pre_selected_vendor == "Architectural Plan":
                is_schedule = True
                is_milgard = False
                is_as400 = False
                is_as400_screen = False
            else:
                # Fall back to auto-detection for unknown vendors
                is_schedule = 'door schedule' in text_lower or 'window schedule' in text_lower
                is_milgard = 'milgard' in text_lower
                is_as400 = (('lorenzo' in text_lower or 'firstsource' in text_lower) 
                        and ('special' in text_lower and 'order' in text_lower)
                        and ('form #254651' in text_lower or 'form #1640' in text_lower or 'document date' in text_lower))
                is_as400_screen = ('order inquiry' in text_lower and 'order #' in text_lower and 'description' in text_lower)
        else:
            # Auto-detect vendor from text
            is_schedule = 'door schedule' in text_lower or 'window schedule' in text_lower
            is_milgard = 'milgard' in text_lower
            is_as400 = (('lorenzo' in text_lower or 'firstsource' in text_lower) 
                    and ('special' in text_lower and 'order' in text_lower)
                    and ('form #254651' in text_lower or 'form #1640' in text_lower or 'document date' in text_lower))
            is_as400_screen = ('order inquiry' in text_lower and 'order #' in text_lower and 'description' in text_lower)
        
        if is_schedule:
            data['vendor'] = 'Architectural Plan'
            if 'door schedule' in text_lower and 'window schedule' in text_lower:
                data['product_type'] = 'Door/Window Schedule'
            elif 'door schedule' in text_lower:
                data['product_type'] = 'Door Schedule'
            else:
                data['product_type'] = 'Window Schedule'

            line_items_json = self.extract_schedule_line_items(text)
            if line_items_json:
                data['line_items'] = line_items_json

            # Fallback/augmentation for noisy OCR: normalized schedule rows for key fields display.
            try:
                parsed_rows = self._extract_schedule_items_for_key_fields(text)
                if parsed_rows:
                    parsed_rows_json = json.dumps(parsed_rows)
                    data['schedule_items'] = parsed_rows_json
                    if not data.get('line_items'):
                        data['line_items'] = parsed_rows_json
            except Exception as e:
                print(f"Schedule key fields parsing warning: {e}")

        elif is_as400_screen:
            # AS400 screen (Order Inquiry) format
            data['vendor'] = 'San Lorenzo'
            data['product_type'] = 'Door'

            # Extract Order Number
            order_match = re.search(r'Order\s*#\s*:\s*(\d+)', text, re.IGNORECASE)
            if order_match:
                data['quote_number'] = order_match.group(1).strip()

            # Extract Customer Number (not a PO number)
            cust_num_match = re.search(r'Customer\s*#\s*:\s*(\d+)', text, re.IGNORECASE)
            if cust_num_match:
                data['customer_number'] = cust_num_match.group(1).strip()

            # Extract Customer Name (strip trailing labels like Cust PO#)
            name_match = re.search(r'Name\s*:\s*([^\n]+)', text, re.IGNORECASE)
            if name_match:
                name_value = name_match.group(1)
                name_value = re.split(r'Cust\s*PO#', name_value, flags=re.IGNORECASE)[0]
                data['customer_name'] = name_value.strip().title()

            # Extract Phone (first phone only)
            phone_match = re.search(r'Phone\s*#\s*:\s*([0-9\-\s]+)', text, re.IGNORECASE)
            if phone_match:
                phone_value = phone_match.group(1).strip()
                phone_value = phone_value.split()[0]
                data['phone'] = phone_value

            # Extract Order Date
            order_date_match = re.search(r'Order\s*Dt\s*:\s*(\d{1,2}/\d{1,2}/\d{2,4})', text, re.IGNORECASE)
            if order_date_match:
                date_str = order_date_match.group(1).replace('-', '/')
                parts = date_str.split('/')
                if len(parts) == 3 and len(parts[2]) == 2:
                    parts[2] = '20' + parts[2]
                data['quote_date'] = f"{parts[0].zfill(2)}/{parts[1].zfill(2)}/{parts[2]}"

            # Extract Totals (prefer SUB-TOTAL for net price before tax)
            subtotal_match = re.search(r'Sub\s*Tot\s*:\s*([\d,]+\.\d{2})', text, re.IGNORECASE)
            tax_match = re.search(r'Tax\s*:\s*([\d,]+\.\d{2})', text, re.IGNORECASE)
            total_match = re.search(r'Total\s*:\s*([\d,]+\.\d{2})', text, re.IGNORECASE)
            # Prefer subtotal (net price before tax) over total
            if subtotal_match:
                data['quote_total'] = f"${subtotal_match.group(1)}"
            elif total_match:
                data['quote_total'] = f"${total_match.group(1)}"

            # Extract line items from AS400 screen format
            line_items_json = self.extract_as400_screen_line_items(text)
            if line_items_json:
                data['line_items'] = line_items_json

        elif is_as400:
            # AS400 San Lorenzo Special Order format - check this FIRST
            # Don't set vendor yet - let it be detected from product name
            
            # Extract Document Number (handle OCR errors like "Dojunent")
            doc_num_match = re.search(r'(?:Document|Dojunent)\s*#\s*(\d+)', text, re.IGNORECASE)
            if doc_num_match:
                data['quote_number'] = doc_num_match.group(1).strip()
            
            # Don't map Transaction # to PO Number - leave PO empty
            
            # Extract Date (format: 2/11/26)
            date_match = re.search(r'Date\s+(\d{1,2}/\d{1,2}/\d{2,4})', text, re.IGNORECASE)
            if date_match:
                date_str = date_match.group(1)
                # Convert 2-digit year to 4-digit if needed
                if '/' in date_str:
                    parts = date_str.split('/')
                    if len(parts[2]) == 2:
                        # Assume 20xx for years 00-99
                        parts[2] = '20' + parts[2]
                    data['quote_date'] = f"{parts[0].zfill(2)}/{parts[1].zfill(2)}/{parts[2]}"
                else:
                    data['quote_date'] = date_str
            
            # Extract customer name (appears multiple times in the order form)
            # Look for the name in "ORDERED BY" or "S D O B" sections
            name_match = re.search(r'(?:ORDERED BY|O\s*MIKE|D\s*MIKE|B\s*MIKE)\s*([A-Z][A-Z\s]+?)(?:\s*\d|\s*iS|\s*$|\n)', text, re.MULTILINE)
            if not name_match:
                # Try simpler pattern - look for capitalized names near phone numbers
                name_match = re.search(r'([A-Z]{2,}\s+[A-Z]{2,})\s*(?:\d{3}[-\s]?\d{3}[-\s]?\d{4})', text)
            if name_match:
                customer_name = name_match.group(1).strip()
                # Clean up multiple spaces
                customer_name = re.sub(r'\s+', ' ', customer_name)
                if customer_name and len(customer_name) > 2:
                    data['customer_name'] = customer_name.title()
            
            # Extract phone number
            phone_match = re.search(r'(\d{3}[-\s]?\d{3}[-\s]?\d{4})', text)
            if phone_match:
                data['phone'] = phone_match.group(1)
            
            # Extract amount/total (prefer subtotal/net price before tax)
            # Try to find subtotal first
            subtotal_match = re.search(r'(?:Sub[-\s]*Total|Subtotal)\s*\$?\s*([\d,]+\.\d{2})', text, re.IGNORECASE)
            if subtotal_match:
                data['quote_total'] = f"${subtotal_match.group(1)}"
            else:
                # Try to find the main total (usually near "Amount")
                amount_match = re.search(r'(?:Amount|Amgunt)\s+\$\s*([\d,]+\.\d{2})', text, re.IGNORECASE)
                if amount_match:
                    data['quote_total'] = f"${amount_match.group(1)}"
                else:
                    # Look for line item total pattern or standalone dollar amounts
                    total_patterns = [
                        r'TOTAL[\s\-]+([\d,]+\.\d{2})',
                        r'(\d{3}\.\d{2})\s*(?:EA|ea)',
                        r'\$\s*([\d,]+\.\d{2})\s+(?:EA|ea)',
                    ]
                    for pattern in total_patterns:
                        total_match = re.search(pattern, text)
                        if total_match:
                            data['quote_total'] = f"${total_match.group(1)}"
                            break
            
            # Extract deposit amount
            deposit_match = re.search(r'Deposit\s+\d+\s+([\d,]+\.\d{2})', text, re.IGNORECASE)
            if deposit_match:
                data['deposit'] = f"${deposit_match.group(1)}"
            
            # Extract line items from AS400 format
            line_items_json = self.extract_as400_line_items(text)
            if line_items_json:
                data['line_items'] = line_items_json
            
            # Detect product vendor from description (Emtek, Jeld-Wen, etc.)
            if 'emtek' in text.lower():
                data['vendor'] = 'Emtek'
            elif 'jeld' in text.lower() or 'jeldwen' in text.lower():
                data['vendor'] = 'Jeld-Wen'
            elif 'schlage' in text.lower():
                data['vendor'] = 'Schlage'
            elif 'kwikset' in text.lower():
                data['vendor'] = 'Kwikset'
            elif 'tmcobb' in text.lower() or 'tm cobb' in text.lower() or 'san lorenzo' in text.lower():
                data['vendor'] = 'San Lorenzo'
            elif 'milgard' in text.lower():
                data['vendor'] = 'Milgard'
            else:
                # Check if it's a generic/store item (bypass doors, hardware, etc.)
                if any(keyword in text.lower() for keyword in ['bypass', 'finger pull', 'jamb', 'track', 'roller']):
                    data['vendor'] = 'San Lorenzo'  # Store item
                else:
                    data['vendor'] = 'Unknown'
        
        elif is_milgard:
            data['vendor'] = 'Milgard'
            
            # For Milgard, "Quote Name" is the customer name, not "Customer"
            # Also extract phone number if it appears after the name (e.g., "Salomon Torres 831-435-0473")
            quote_name_match = re.search(r'Quote Name:\s*([^\n]+?)(?:\s+Quote Number:|\n)', text, re.IGNORECASE)
            if quote_name_match:
                quote_name_line = quote_name_match.group(1).strip()
                
                # Try to extract phone number from the quote name line
                # Look for pattern: name followed by phone number
                phone_match = re.search(r'(.+?)\s+(\d{3}[-\.]?\d{3}[-\.]?\d{4})', quote_name_line)
                if phone_match:
                    data['customer_name'] = phone_match.group(1).strip()
                    # Format phone number consistently (remove dashes/dots, add hyphens)
                    raw_phone = phone_match.group(2)
                    data['phone'] = re.sub(r'[\.\-]', '', raw_phone)[:3] + '-' + re.sub(r'[\.\-]', '', raw_phone)[3:6] + '-' + re.sub(r'[\.\-]', '', raw_phone)[6:]
                else:
                    data['customer_name'] = quote_name_line
            
            # Extract Quote Number (with underscore format: SQPGBI002838_1)
            quote_num_match = re.search(r'Quote Number:\s*([A-Z0-9_]+)', text, re.IGNORECASE)
            if quote_num_match:
                data['quote_number'] = quote_num_match.group(1).strip()
            
            # Extract dates (Created Date or Modified Date)
            created_date_match = re.search(r'Created Date:\s*(\d{1,2}/\d{1,2}/\d{4})', text, re.IGNORECASE)
            if created_date_match:
                data['quote_date'] = created_date_match.group(1)
            
            # Extract totals - prioritize Material Subtotal (net price before tax)
            # Try Material Subtotal first
            subtotal_match = re.search(r'Material Subtotal:\s*\$([\d,]+\.\d{2})', text, re.IGNORECASE)
            if subtotal_match:
                data['quote_total'] = f"${subtotal_match.group(1)}"
            else:
                # Try Line Total sum
                line_totals = re.findall(r'Line Total:\s*\$([\d,]+\.\d{2})', text, re.IGNORECASE)
                if line_totals:
                    # Sum all line totals for multi-item quotes
                    total = sum(float(lt.replace(',', '')) for lt in line_totals)
                    data['quote_total'] = f"${total:.2f}"
                else:
                    # Last resort: Grand Total (may include tax)
                    grand_total_match = re.search(r'Grand Total[^$]*\$\s*([\d,]+\.\d{2})', text, re.IGNORECASE)
                    if grand_total_match:
                        data['quote_total'] = f"${grand_total_match.group(1)}"
            
            # Extract Milgard series (V400 Tuscany, C350, etc.)
            series_match = re.search(r'(V\d{3}\s+\w+|C\d{3}\s+\w+|A\d{3}\s+\w+)', text, re.IGNORECASE)
            if series_match:
                data['series'] = series_match.group(1)
            
            # Extract operation style (look for full phrases like "Inswing Two Panel")
            operation_patterns = [
                r'(Inswing\s+(?:Single|Two|Three)\s+Panel)',
                r'(Outswing\s+(?:Single|Two|Three)\s+Panel)',
                r'(Single Hung)',
                r'(Double Hung)',
                r'(Horizontal Slider)',
                r'(Casement)',
                r'(Picture)',
                r'(Awning)',
                r'(Bay)',
                r'(Bow)'
            ]
            for pattern in operation_patterns:
                op_match = re.search(pattern, text, re.IGNORECASE)
                if op_match:
                    data['operation_style'] = op_match.group(1)
                    break
            
            # Extract finishes (Ext White / Int White format)
            finish_match = re.search(r'Ext\s+(\w+)\s*/\s*Int\s+(\w+)', text, re.IGNORECASE)
            if finish_match:
                data['exterior_finish'] = finish_match.group(1)
                data['interior_finish'] = finish_match.group(2)
            
            # Extract size (RO: 62" x 82")
            size_match = re.search(r'RO:\s*(\d+["\']?\s*x\s*\d+["\']?)', text, re.IGNORECASE)
            if size_match:
                data['size'] = size_match.group(1)
            
            # Extract glass info (combine all glass properties found)
            glass_keywords = [
                'SunCoatMAX', 'SunCoat', 'Low-E', 'Tempered', 'Laminated',
                'Dual Glaze', 'Triple Glaze', 'Argon', 'Krypton',
                'Obscure', 'Privacy', 'Impact'
            ]
            found_glass = []
            for keyword in glass_keywords:
                if keyword.lower() in text.lower():
                    if keyword not in found_glass:  # Avoid duplicates
                        found_glass.append(keyword)
            if found_glass:
                data['glass'] = ', '.join(found_glass)
            
            # Extract all line items
            line_items_json = self.extract_milgard_line_items(text)
            if line_items_json:
                data['line_items'] = line_items_json

            # Extract windows/doors counts (helps indicate what unit details are present)
            tw_match = re.search(r'Total\s*Windows\s*:\s*(\d+)', text, re.IGNORECASE)
            td_match = re.search(r'Total\s*Doors\s*:\s*(\d+)', text, re.IGNORECASE)
            if tw_match:
                data['total_windows'] = tw_match.group(1)
            if td_match:
                data['total_doors'] = td_match.group(1)

            # Extract model/operation/handing directly when present.
            model_line = re.search(r'Model\s*=\s*([^\n]+)', text, re.IGNORECASE)
            if model_line and not data.get('model'):
                data['model'] = model_line.group(1).strip()
            if model_line and not data.get('operation_style'):
                data['operation_style'] = model_line.group(1).strip()

            handing_line = re.search(r'Handing\s*=\s*([A-Z]{1,3})', text, re.IGNORECASE)
            if handing_line and not data.get('handing'):
                data['handing'] = handing_line.group(1).upper()

            # Size appears as: Size = Net Frame: 47" x 35" (OCR may use degree symbol)
            if not data.get('size'):
                nf_match = re.search(r'Size\s*=\s*Net\s*Frame\s*:\s*([0-9 /"\'\-xX°]+)', text, re.IGNORECASE)
                if nf_match:
                    s = nf_match.group(1).strip().replace('°', '"')
                    data['size'] = re.sub(r'\s+', ' ', s)

            # Promote line-item details into top-level key fields for export/import.
            if data.get('line_items'):
                try:
                    items = json.loads(data['line_items'])
                    if isinstance(items, list) and items:
                        valid_items = [it for it in items if isinstance(it, dict)]
                        if valid_items:
                            first = valid_items[0]

                            # Milgard OCR can mis-associate line numbers into quantity fields.
                            # Reconcile quantities only when totals are clearly corrupted.
                            expected_units = 0
                            try:
                                expected_units = int(str(data.get('total_windows') or '0')) + int(str(data.get('total_doors') or '0'))
                            except Exception:
                                expected_units = 0

                            qty_values = []
                            for it in valid_items:
                                try:
                                    qty_values.append(int(it.get('quantity', 0)))
                                except Exception:
                                    qty_values.append(0)
                            parsed_qty_total = sum(qty_values)

                            qty_is_corrupt = False
                            if expected_units > 0:
                                # Trigger only for obvious corruption (e.g., 255 vs expected 24).
                                qty_is_corrupt = parsed_qty_total > (expected_units * 2)

                            if qty_is_corrupt:
                                for it in valid_items:
                                    parsed_q = 0
                                    try:
                                        parsed_q = int(it.get('quantity', 0))
                                    except Exception:
                                        parsed_q = 0

                                    line_total = None
                                    item_total = None
                                    try:
                                        if it.get('line_total'):
                                            line_total = float(str(it.get('line_total')).replace(',', ''))
                                        if it.get('item_total'):
                                            item_total = float(str(it.get('item_total')).replace(',', ''))
                                    except Exception:
                                        line_total = None
                                        item_total = None

                                    derived_q = 0
                                    if line_total and item_total and item_total > 0:
                                        ratio = line_total / item_total
                                        nearest = int(round(ratio))
                                        if nearest >= 1 and abs(ratio - nearest) < 0.06:
                                            derived_q = nearest

                                    # Prefer mathematically-derived qty; otherwise keep plausible small qty.
                                    if derived_q >= 1:
                                        it['quantity'] = derived_q
                                    elif 1 <= parsed_q <= 10:
                                        it['quantity'] = parsed_q
                                    else:
                                        it['quantity'] = 1

                                # Persist reconciled quantities for export/import and displayed line items.
                                data['line_items'] = json.dumps(valid_items)

                            def _compact(values, limit=3):
                                cleaned = []
                                for value in values:
                                    value = re.sub(r'\s+', ' ', str(value or '')).strip()
                                    if value and value not in cleaned:
                                        cleaned.append(value)
                                if not cleaned:
                                    return ''
                                if len(cleaned) <= limit:
                                    return ', '.join(cleaned)
                                remaining = len(cleaned) - limit
                                return f"{', '.join(cleaned[:limit])} (+{remaining} more)"

                            models = [it.get('model') for it in valid_items if it.get('model')]
                            ops = [it.get('operation') for it in valid_items if it.get('operation')]
                            sizes = [it.get('size') for it in valid_items if it.get('size')]
                            handings = [
                                it.get('swing') or it.get('handing')
                                for it in valid_items
                                if it.get('swing') or it.get('handing')
                            ]

                            if models:
                                data['model'] = _compact(models) or str(first.get('model', '')).strip()
                            elif not data.get('model'):
                                data['model'] = str(first.get('model', '')).strip()

                            if ops:
                                data['operation_style'] = _compact(ops) or str(first.get('operation', '')).strip()
                            elif not data.get('operation_style'):
                                data['operation_style'] = str(first.get('operation', '')).strip()

                            # For multi-unit quotes, show that sizes vary instead of only item #1 size.
                            if sizes:
                                uniq_sizes = []
                                for size in sizes:
                                    norm = re.sub(r'\s+', ' ', str(size).strip())
                                    if norm and norm not in uniq_sizes:
                                        uniq_sizes.append(norm)
                                if len(uniq_sizes) == 1 and not data.get('size'):
                                    data['size'] = uniq_sizes[0]
                                elif len(uniq_sizes) > 1:
                                    data['size'] = f"Multiple sizes ({len(uniq_sizes)}): {_compact(uniq_sizes)}"

                            if handings:
                                handings_norm = [str(h).strip() for h in handings if str(h).strip()]
                                data['handing'] = _compact(handings_norm)
                            elif not data.get('handing') and (first.get('swing') or first.get('handing')):
                                data['handing'] = str(first.get('swing') or first.get('handing')).strip()

                            # Set a meaningful product type for mixed quotes so filename hints don't force "Door".
                            tw = int(str(data.get('total_windows') or '0')) if str(data.get('total_windows') or '').isdigit() else 0
                            td = int(str(data.get('total_doors') or '0')) if str(data.get('total_doors') or '').isdigit() else 0
                            if tw > 0 and td > 0:
                                data['product_type'] = 'Window + Door'
                            elif tw > 0:
                                data['product_type'] = 'Window'
                            elif td > 0:
                                data['product_type'] = 'Door'
                except Exception:
                    pass
        
        elif ('tmcobb' in text.lower() or 'tim.cobb' in text.lower() or 
              ('san lorenzo' in text.lower() and 'quote number:' in text.lower())):
            # TMCobb / San Lorenzo VENDOR quote format (not AS400)
            data['vendor'] = 'TMCobb'

            # OCR is often noisy/split across lines; normalize lightly for label extraction.
            text_norm = re.sub(r'[\t\r]+', ' ', text)
            text_norm = re.sub(r'\n+', '\n', text_norm)

            def _extract_label_value(label_regex: str, max_len: int = 120) -> str:
                # 1) Label and value on same line
                m = re.search(label_regex + r'\s*[:#]?\s*([^\n]{1,' + str(max_len) + r'})', text_norm, re.IGNORECASE)
                if m:
                    return m.group(1).strip()
                # 2) Label on one line, value on next line
                m = re.search(label_regex + r'\s*[:#]?\s*\n\s*([^\n]{1,' + str(max_len) + r'})', text_norm, re.IGNORECASE)
                return m.group(1).strip() if m else ""
            
            # Extract Quote Number
            quote_num_val = _extract_label_value(r'Quote\s*Number')
            if quote_num_val:
                # Keep compact token for quote number (allow common OCR quote formats)
                quote_num_val = quote_num_val.split()[0]
                if re.match(r'^[A-Z0-9_-]{1,30}$', quote_num_val, re.IGNORECASE):
                    data['quote_number'] = quote_num_val
            
            # Extract Date
            quote_date_val = _extract_label_value(r'(?<!Version\s)Date')
            if quote_date_val:
                dm = re.search(r'(\d{1,2}/\d{1,2}/\d{2,4})', quote_date_val)
                if dm:
                    d = dm.group(1)
                    parts = d.split('/')
                    if len(parts) == 3 and len(parts[2]) == 2:
                        parts[2] = '20' + parts[2]
                    data['quote_date'] = f"{parts[0]}/{parts[1]}/{parts[2]}"

            # Fix common OCR swap where quote/date labels are crossed.
            if data.get('quote_number') and re.match(r'^\d{1,2}/\d{1,2}/\d{2,4}$', data['quote_number']):
                if not data.get('quote_date'):
                    data['quote_date'] = data['quote_number']
                data['quote_number'] = ""

            if data.get('quote_date') and re.match(r'^\d+$', data['quote_date']):
                if not data.get('quote_number'):
                    data['quote_number'] = data['quote_date']
                data['quote_date'] = ""

            # Fallback search for quote number if still empty.
            if not data.get('quote_number'):
                m = re.search(r'Quote\s*Number\s*[:#]?\s*([^\s\n]{1,30})', text_norm, re.IGNORECASE)
                if m:
                    qv = m.group(1).strip()
                    # Reject date tokens and partial date prefixes like "3" in "3/4/2026".
                    if not re.match(r'^\d{1,2}/\d{1,2}/\d{2,4}$', qv):
                        tail = text_norm[m.end():m.end()+8]
                        if not (qv.isdigit() and tail.startswith('/')):
                            data['quote_number'] = qv

            # Handle common OCR label swap:
            # Quote Date: 51   Quote Number: 3/4/2026
            if not data.get('quote_number'):
                swap_match = re.search(
                    r'Quote\s*Date\s*[:#]?\s*(\d{1,8})\s+Quote\s*Number\s*[:#]?\s*(\d{1,2}/\d{1,2}/\d{2,4})',
                    text_norm,
                    re.IGNORECASE
                )
                if swap_match:
                    data['quote_number'] = swap_match.group(1).strip()
                    if not data.get('quote_date'):
                        d = swap_match.group(2).strip()
                        parts = d.split('/')
                        if len(parts) == 3 and len(parts[2]) == 2:
                            parts[2] = '20' + parts[2]
                        data['quote_date'] = f"{parts[0]}/{parts[1]}/{parts[2]}"
            
            # Extract Order Total (appears on last page)
            # Extract Order Total (prefer SUB-TOTAL for net price before tax)
            # Try Sub Total first (net before tax)
            sub_total_match = re.search(r'Order\s*Sub\s*Total\s*:?\s*\$?\s*([\d,]+\.\d{2})', text_norm, re.IGNORECASE)
            if sub_total_match:
                data['quote_total'] = f"${sub_total_match.group(1)}"
            else:
                # Fallback to Order Total
                order_total_match = re.search(r'Order\s*Total\s*:?\s*\$?\s*([\d,]+\.\d{2})', text_norm, re.IGNORECASE)
                if order_total_match:
                    data['quote_total'] = f"${order_total_match.group(1)}"
                else:
                    # Sum all item totals if available
                    item_totals = re.findall(r'Item\s*Total[:\s]+\$?\s*([\d,]+\.\d{2})', text_norm, re.IGNORECASE)
                    if item_totals:
                        total = sum(float(it.replace(',', '')) for it in item_totals)
                        data['quote_total'] = f"${total:.2f}"
            
            # Extract customer name from Name label (same line or next line)
            name_value = _extract_label_value(r'Name')
            if name_value:
                # Strip trailing accidental labels and separators.
                name_value = re.split(r'\b(Address|Phone\s*1|Phone\s*2|Fax|Contact)\b', name_value, flags=re.IGNORECASE)[0].strip(' :-|_')
                if name_value and len(name_value) > 2 and not re.match(r'^[0-9\s\-]+$', name_value):
                    data['customer_name'] = name_value
            
            # Extract phone number from Phone 1 label with OCR fallback to any US phone.
            phone_value = _extract_label_value(r'Phone\s*1')
            phone_match = re.search(r'(\d{3}[-\.\s]?\d{3}[-\.\s]?\d{4})', phone_value)
            if not phone_match:
                phone_match = re.search(r'(\d{3}[-\.\s]?\d{3}[-\.\s]?\d{4})', text_norm)
            if phone_match:
                digits = re.sub(r'\D', '', phone_match.group(1))
                if len(digits) == 10:
                    data['phone'] = f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
            
            # Extract specifications (R.O. size into rough_opening)
            ro_match = re.search(r'R\.O\.\s*=\s*([0-9"\'\-\sx]+?)(?:\n|;|Jamb)', text, re.IGNORECASE)
            if ro_match:
                data['rough_opening'] = ro_match.group(1).strip()
            
            # Extract line items from TMCobb format
            line_items_json = self.extract_tmcobb_line_items(text)
            if line_items_json:
                data['line_items'] = line_items_json

            # Promote key door details from line items/text into top-level key fields.
            if data.get('line_items'):
                try:
                    items = json.loads(data['line_items'])
                    if items and isinstance(items, list):
                        first = items[0] if isinstance(items[0], dict) else {}
                        if first.get('size') and not data.get('size'):
                            data['size'] = first.get('size')
                        if first.get('jamb') and not data.get('jamb'):
                            data['jamb'] = first.get('jamb')
                        if first.get('glass') and not data.get('glass'):
                            data['glass'] = first.get('glass')
                        if first.get('description') and not data.get('door_style'):
                            data['door_style'] = first.get('description')[:120]
                except Exception:
                    pass

            if not data.get('size'):
                # Preferred TMCobb format: 1' 10'' x 6' 8'' (22'' x 80'')
                full_size_match = re.search(
                    r"(\d+\s*['’]\s*\d+\s*['\"’]{1,2}\s*[xX]\s*\d+\s*['’]\s*\d+\s*['\"’]{1,2})\s*\(\s*(\d{1,3})\s*['\"’]{1,2}\s*[xX]\s*(\d{1,3})\s*['\"’]{1,2}\s*\)",
                    text,
                    re.IGNORECASE,
                )
                if full_size_match:
                    outer = full_size_match.group(1)
                    outer = outer.replace('’', "'")
                    outer = re.sub(r"'{2,}", '"', outer)
                    outer = re.sub(r"\s+", " ", outer).strip()
                    w_in = int(full_size_match.group(2))
                    h_in = int(full_size_match.group(3))
                    data['size'] = f"{outer} ({w_in}\" x {h_in}\")"

            if not data.get('size'):
                size_match = re.search(
                    r"(\d+\s*['’]\s*\d+\s*['\"’]{1,2}\s*[xX]\s*\d+\s*['’]\s*\d+\s*['\"’]{1,2})",
                    text,
                    re.IGNORECASE
                )
                if size_match:
                    size_clean = size_match.group(1)
                    size_clean = size_clean.replace('’', "'")
                    size_clean = re.sub(r"'{2,}", '"', size_clean)
                    data['size'] = re.sub(r'\s+', ' ', size_clean).strip()

            if not data.get('size'):
                # Final fallback from parenthetical inches only: (22'' x 80'')
                in_match = re.search(
                    r"\(\s*(\d{1,3})\s*['\"’]{1,2}\s*[xX]\s*(\d{1,3})\s*['\"’]{1,2}\s*\)",
                    text,
                    re.IGNORECASE,
                )
                if in_match:
                    data['size'] = f"{int(in_match.group(1))}\" x {int(in_match.group(2))}\""
            
            # Detect door configuration (Slab vs Prehung)
            text_lower = text.lower()
            if 'prehung' in text_lower or 'pre-hung' in text_lower:
                data['door_configuration'] = 'Prehung'
            elif 'slab' in text_lower and 'door' in text_lower:
                data['door_configuration'] = 'Slab'
            elif 'frame' in text_lower and re.search(r'\d+-\d+/\d+["\']?\s*(?:jamb|frame)', text_lower):
                # If it has "frame" and a jamb width (e.g., "4-9/16"), it's prehung
                data['door_configuration'] = 'Prehung'
            elif data.get('rough_opening'):
                # If there's a jamb size mentioned, it's likely prehung
                if re.search(r'\d+-\d+/\d+["\']?\s*jamb', text_lower):
                    data['door_configuration'] = 'Prehung'
        
        elif ('orepac' in text.lower() or 'ore pac' in text.lower()) and 'marketplace' in text.lower():
            # OrePac Marketplace format (not San Lorenzo system)
            data['vendor'] = 'OrePac'
            
            # Extract Quote Number (appears as "QuoteNo" or "Quote:" or from FORM system)
            quote_num_match = re.search(r'(?:QuoteNo|Quote:)\s*(\d+)', text, re.IGNORECASE)
            if not quote_num_match:
                # Try to find document number from form systems (Key: 55-1816 or Key: 55- 1816!)
                quote_num_match = re.search(r'Key:\s*\d+[-\s]+(\d+)', text, re.IGNORECASE)
            if quote_num_match:
                data['quote_number'] = quote_num_match.group(1).strip()
            
            # Extract Date (Date quoted: or DOCUMENT DATE format)
            date_match = re.search(r'Date quoted:\s*(\d{1,2}/\d{1,2}/\d{4})', text, re.IGNORECASE)
            if not date_match:
                # Try Document Date format with various patterns
                date_match = re.search(r'DOCUMENT DATE[^\d]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', text, re.IGNORECASE)
            if not date_match:
                # Try simpler date pattern
                date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{2,4})', text)
            if date_match:
                date_str = date_match.group(1).replace('-', '/')
                # Normalize date format
                if '/' in date_str:
                    parts = date_str.split('/')
                    if len(parts) == 3 and len(parts[2]) == 2:
                        parts[2] = '20' + parts[2]
                    data['quote_date'] = f"{parts[0].zfill(2)}/{parts[1].zfill(2)}/{parts[2]}"
                else:
                    data['quote_date'] = date_str
            
            # Extract Customer (after "Customer:" label or from ORDERED BY)
            customer_match = re.search(r'Customer:\s*([^\n]+?)(?:Salesperson:|$)', text, re.IGNORECASE)
            if not customer_match:
                # Try ORDERED BY pattern
                customer_match = re.search(r'ORDERED BY[^\n]*\n[^\n]*([A-Z]{2,}\s+[A-Z]{2,})', text)
            if customer_match:
                customer_value = customer_match.group(1).strip()
                if customer_value and len(customer_value) > 2:
                    data['customer_name'] = customer_value.title()

            # Extract Sidemark (often the actual end-customer/person name for OrePac)
            sidemark_value = ""
            sidemark_match = re.search(
                r'QuoteNo\s*\|\s*PO\s*\|\s*sidemark\s*\|[^\n]*\n\s*\d+\s+([^\n\|]+)',
                text,
                re.IGNORECASE
            )
            if sidemark_match:
                sidemark_value = sidemark_match.group(1).strip()
            if not sidemark_value:
                sidemark_match = re.search(
                    r'Quote\s*No\s*\nPO\s*\nSidemark\s*\nNotes\s*\n\d+\s*\n([^\n]+)',
                    text,
                    re.IGNORECASE
                )
                if sidemark_match:
                    sidemark_value = sidemark_match.group(1).strip()
            if not sidemark_value and data.get('quote_number'):
                # Fallback: line that starts with the quote number followed by sidemark name
                sidemark_match = re.search(
                    rf'(?mi)^\s*{re.escape(data.get("quote_number", ""))}\s+([A-Za-z][A-Za-z\s\'\.-]+?)\s*$',
                    text
                )
                if sidemark_match:
                    sidemark_value = sidemark_match.group(1).strip()

            # Strip trailing numeric-only fragments (e.g. sidemark order IDs like "0182")
            if sidemark_value:
                sidemark_value = re.sub(r'\s+\d+\s*$', '', sidemark_value).strip()

            # Prefer sidemark when customer field looks like account/location text
            if sidemark_value:
                sidemark_name = re.sub(r'\s+', ' ', sidemark_value).strip()
                current_customer = (data.get('customer_name') or '').strip()
                customer_looks_generic = any(k in current_customer.lower() for k in [
                    'contractor', 'sql', 'pro build', 'ship-to', 'location', 'door shop'
                ])
                if not current_customer or customer_looks_generic:
                    data['customer_name'] = sidemark_name.title()
            
            # Extract PO (strict formats only: 55-55555 or 55-55555TA)
            po_value = ""
            po_match = re.search(r'QuoteNo\s*\|\s*PO\s*\|.*?\n\s*\d+\s+([^\|]+)', text, re.IGNORECASE)
            if po_match:
                po_value = po_match.group(1).strip()
            if not po_value:
                po_match = re.search(r'P\.O\.\s*NUMBER[^\n]*\n[^\n]*([^\n]+)', text, re.IGNORECASE)
                if po_match:
                    po_value = po_match.group(1).strip()

            normalized_po = self._normalize_po_number(po_value)
            if not normalized_po:
                # Fallback scan anywhere in OCR text for valid PO pattern
                po_anywhere = re.search(r'\b\d{2}\s*-\s*\d{5}(?:\s*TA)?\b', text, re.IGNORECASE)
                if po_anywhere:
                    normalized_po = self._normalize_po_number(po_anywhere.group(0))

            if normalized_po:
                data['po_number'] = normalized_po
            
            # Extract Quote Total (prefer SUB-TOTAL for net price before tax)
            # Try subtotal first
            subtotal_match = re.search(r'(?:Sub[-\s]*Total|Subtotal):\s*\$([\d,]+\.\d{2})', text, re.IGNORECASE)
            if subtotal_match:
                data['quote_total'] = f"${subtotal_match.group(1)}"
            else:
                # Try Quote Total
                quote_total_match = re.search(r'Quote Total:\s*\$([\d,]+\.\d{2})', text, re.IGNORECASE)
                if quote_total_match:
                    data['quote_total'] = f"${quote_total_match.group(1)}"
                else:
                    # Try other total patterns (TAR AMOUNT, DOCUMENT TOTAL, etc.)
                    total_patterns = [
                        r'([\d,]+\.\s*\d+[-]?)\s*(?:LOT|Lor)',  # Pattern like "1,416. 10- LOT" or "1416.10 LOT"
                        r'TAR\s*AMOUNT[^\d]+([\d,]+[.\-]\d+)',
                        r'DOCUMENT\s*TOTAL[^\d]+([\d,]+\.\d{2})',
                        r'Deposit[^\d]+([\d,]+\.\d{2})',
                    ]
                    for pattern in total_patterns:
                        total_match = re.search(pattern, text, re.IGNORECASE)
                        if total_match:
                            amount = total_match.group(1).strip()
                            # Clean up OCR errors: remove spaces and trailing dashes
                            amount = amount.replace(' ', '').rstrip('-')
                            # Ensure proper decimal format
                            if '.' in amount:
                                parts = amount.split('.')
                                if len(parts) == 2 and len(parts[1]) > 2:
                                    amount = f"{parts[0]}.{parts[1][:2]}"  # Keep only 2 decimal places
                            data['quote_total'] = f"${amount}"
                            break
            
            # Extract Product Series (Builders Choice, etc.)
            series_match = re.search(r'Product Series\s+([^\n]+)', text, re.IGNORECASE)
            if series_match:
                data['series'] = series_match.group(1).strip()
            
            # Extract Model Number
            model_match = re.search(r'Model Number\s+([^\n]+)', text, re.IGNORECASE)
            if model_match:
                data['model'] = model_match.group(1).strip()
            
            # Extract Door Style (5 Panel EQ, etc.)
            style_match = re.search(r'Door Style\s+([^\n]+)', text, re.IGNORECASE)
            if style_match:
                data['door_style'] = style_match.group(1).strip()
            
            # Extract Wood Species (Primed, Oak, etc.)
            species_match = re.search(r'Wood Species\s+([^\n]+)', text, re.IGNORECASE)
            if species_match:
                species_value = species_match.group(1).strip()
                data['exterior_finish'] = species_value
                data['interior_finish'] = species_value
            
            # Extract Door Thickness
            thickness_match = re.search(r'Door Thickness\s+([\d\s/]+["\']?)', text, re.IGNORECASE)
            if thickness_match:
                data['thickness'] = thickness_match.group(1).strip()
            
            # Extract Door Configuration
            config_match = re.search(r'Door Configuration\s+([^\n]+)', text, re.IGNORECASE)
            if config_match:
                config_value = config_match.group(1).strip()
                if 'slab' in config_value.lower():
                    data['door_configuration'] = 'Slab'
                elif 'prehung' in config_value.lower():
                    data['door_configuration'] = 'Prehung'
                else:
                    data['door_configuration'] = config_value
            
            # Extract sizes (Door Width and Door Height)
            width_match = re.search(r'Door Width\s+(\d+/\d+)', text, re.IGNORECASE)
            height_match = re.search(r'Door Height\s+(\d+/\d+)', text, re.IGNORECASE)
            if width_match and height_match:
                data['size'] = f"{width_match.group(1)} x {height_match.group(1)}"
            
            # Extract line items for OrePac
            line_items_json = self.extract_orepac_line_items(text)
            if line_items_json:
                data['line_items'] = line_items_json
        
        else:
            # Generic extraction for other vendors
            field_mapping = {
                'Customer': 'customer_name',
                'Phone': 'phone',
                'Mobile': 'phone',
                'Email': 'email',
                'Quote Number': 'quote_number',
                'PO Number': 'po_number',
            }
            
            for field_name, value in base_fields.items():
                base_name = field_name.split(' ')[0] + (' ' + field_name.split(' ')[1] if len(field_name.split()) > 1 and field_name.split()[1] != '1' else '')
                if base_name in field_mapping:
                    data[field_mapping[base_name]] = value
            
            # Extract dates
            date_matches = re.findall(r'(\d{1,2}/\d{1,2}/\d{4})', text)
            if date_matches:
                data['quote_date'] = date_matches[0]
            
            # Extract totals (prefer subtotal/net price before tax)
            # Try subtotal first
            subtotal_match = re.search(r'(?:Sub[-\s]*Total|Subtotal)[^$]*\$([\d,]+\.\d{2})', text, re.IGNORECASE)
            if subtotal_match:
                data['quote_total'] = f"${subtotal_match.group(1)}"
            else:
                # Try other total patterns
                total_patterns = [
                    r'Line Total[^$]*\$([\d,]+\.\d{2})',
                    r'Item Total[^$]*\$([\d,]+\.\d{2})',
                    r'Total[^$]*\$([\d,]+\.\d{2})'
                ]
                for pattern in total_patterns:
                    matches = re.findall(pattern, text, re.IGNORECASE)
                    if matches:
                        amounts = [float(m.replace(',', '')) for m in matches]
                        data['quote_total'] = f"${max(amounts):.2f}"
                        break
            
            # Detect vendor
            if 'jeld' in text.lower() or 'jeldwen' in text.lower():
                data['vendor'] = 'Jeld-Wen'
            elif 'pella' in text.lower():
                data['vendor'] = 'Pella'
            elif 'anderson' in text.lower() or 'andersen' in text.lower() or pre_selected_vendor == 'Andersen':
                data['vendor'] = 'Andersen'
                
                # Andersen-specific extraction
                # Clear any generic quote_total so Andersen-specific extraction can run
                if 'quote_total' in data:
                    del data['quote_total']
                
                # Extract customer name from "QUOTE NAME" field (appears before PROJECT NAME)
                quote_name_match = re.search(r'QUOTE\s+NAME[^\n]*\n[^\n]*\n\s*([A-Za-z][A-Za-z\s]+?)(?:\s+PROJECT\s+NAME|$|\n\d|\n\s*\n)', text, re.IGNORECASE | re.MULTILINE)
                if not quote_name_match:
                    # Try simpler pattern: QUOTE NAME followed by a name on next line or two
                    quote_name_match = re.search(r'QUOTE\s+NAME[^\n]*\n\s*([A-Z][a-z]+\s+[A-Z][a-z]+)', text, re.IGNORECASE)
                if quote_name_match:
                    customer_name = quote_name_match.group(1).strip()
                    # Clean up extra words like "PROJECT", numbers, etc.
                    customer_name = re.sub(r'\s+\d+.*$', '', customer_name)
                    customer_name = re.sub(r'\s+(PROJECT|QUOTE|CUSTOMER).*$', '', customer_name, flags=re.IGNORECASE)
                    if customer_name and len(customer_name) > 2:
                        data['customer_name'] = customer_name.title()
                
                # Extract quote number
                if not data.get('quote_number'):
                    quote_num_match = re.search(r'(?:QUOTE\s+NUMBER|Quote\s*#)[^\d]*(\d+)', text, re.IGNORECASE)
                    if quote_num_match:
                        data['quote_number'] = quote_num_match.group(1).strip()
                
                # Extract quote date (CREATED DATE or LATEST UPDATE)
                if not data.get('quote_date'):
                    date_match = re.search(r'(?:CREATED\s+DATE|LATEST\s+UPDATE)[^\d]*(\d{1,2}/\d{1,2}/\d{4})', text, re.IGNORECASE)
                    if date_match:
                        data['quote_date'] = date_match.group(1).strip()
                
                # Extract quote total (prefer SUB-TOTAL for net price before tax)
                # DEBUG: Write extraction debug info to file (always for Andersen)
                debug_file = Path("andersen_debug.txt")
                with open(debug_file, 'w', encoding='utf-8') as f:
                        f.write("=" * 60 + "\n")
                        f.write("ANDERSEN QUOTE TOTAL EXTRACTION DEBUG\n")
                        f.write("=" * 60 + "\n\n")
                        
                        # Show section around TOTAL/TAX/SUB-TOTAL
                        total_pos = text.find('TOTAL:')
                        if total_pos > 0:
                            section = text[max(0, total_pos-100):total_pos+400]
                            f.write("Text section around TOTAL:\n")
                            f.write("-" * 60 + "\n")
                            f.write(section)
                            f.write("\n" + "-" * 60 + "\n\n")
                        
                        # Pattern 1: Detect label group (TAX, LABOR, FREIGHT, SUB-TOTAL) followed by value group
                        f.write("PATTERN 1: Looking for label group with SUB-TOTAL\n")
                        # Look for TAX: LABOR: FREIGHT: SUB-TOTAL: pattern (labels grouped together)
                        label_group_match = re.search(r'TAX:\s*\n\s*LABOR:\s*\n\s*FREIGHT:\s*\n\s*SUB[-\s]*TOTAL:\s*\n', text, re.IGNORECASE)
                        if label_group_match:
                            f.write(f"  ✓ FOUND label group at position {label_group_match.start()}\n")
                            # Get text after the label group
                            after_labels = text[label_group_match.end():label_group_match.end()+150]
                            f.write(f"  Text after labels: {after_labels[:100]}...\n")
                            # Extract 4 amounts in order (TAX, LABOR, FREIGHT, SUB-TOTAL)
                            amounts = re.findall(r'\$?([\d,]+\.\d{2})', after_labels[:100])
                            f.write(f"  Amounts found: {amounts[:5]}\n")
                            if len(amounts) >= 4:
                                f.write(f"  Position [0]=TAX: ${amounts[0]}\n")
                                f.write(f"  Position [1]=LABOR: ${amounts[1]}\n")
                                f.write(f"  Position [2]=FREIGHT: ${amounts[2]}\n")
                                f.write(f"  Position [3]=SUB-TOTAL: ${amounts[3]} ← SELECTED!\n")
                                data['quote_total'] = f"${amounts[3]}"
                            else:
                                f.write(f"  ✗ Expected 4 amounts but found {len(amounts)}\n")
                        else:
                            f.write("  ✗ Label group pattern not found\n")
                        f.write("\n")
                        
                        # Pattern 2: TAX label with amounts following
                        if not data.get('quote_total'):
                            f.write("PATTERN 2: Looking for TAX: label then amounts\n")
                            tax_match = re.search(r'TAX:\s*\n', text, re.IGNORECASE)
                            if not tax_match:
                                tax_match = re.search(r'TAX:', text, re.IGNORECASE)
                            
                            if tax_match:
                                f.write(f"  ✓ Found TAX: at position {tax_match.start()}\n")
                                after_tax = text[tax_match.end():]
                                amounts = re.findall(r'\$?([\d,]+\.\d{2})', after_tax[:300])
                                f.write(f"  Amounts after TAX: {amounts[:8]}\n")
                                
                                # Look for pattern: small -> large
                                for i in range(len(amounts) - 1):
                                    curr_val = float(amounts[i].replace(',', ''))
                                    next_val = float(amounts[i+1].replace(',', '')) if i+1 < len(amounts) else 0
                                    f.write(f"    [{i}] ${amounts[i]} ({curr_val:.2f}) -> [{i+1}] ${amounts[i+1]} ({next_val:.2f})")
                                    if 100 < curr_val < 1000 and next_val > 1000:
                                        data['quote_total'] = f"${amounts[i+1]}"
                                        f.write(f" ← SELECTED!\n")
                                        break
                                    f.write("\n")
                            else:
                                f.write("  ✗ TAX: not found\n")
                            f.write("\n")
                        
                        # Pattern 3: SUB-TOTAL label then scan for amounts
                        if not data.get('quote_total'):
                            f.write("PATTERN 3: Looking for SUB-TOTAL: label then amounts\n")
                            subtotal_pos = re.search(r'SUB[-\s]*TOTAL:', text, re.IGNORECASE)
                            if subtotal_pos:
                                f.write(f"  ✓ Found SUB-TOTAL: at position {subtotal_pos.start()}\n")
                                after_subtotal = text[subtotal_pos.end():subtotal_pos.end()+150]
                                f.write(f"  Text after: {after_subtotal[:100]}...\n")
                                amounts = re.findall(r'\$?([\d,]+\.\d{2})', after_subtotal)
                                f.write(f"  Amounts found: {amounts[:5]}\n")
                                for amt in amounts:
                                    amt_val = float(amt.replace(',', ''))
                                    f.write(f"    ${amt} ({amt_val:.2f})")
                                    if amt_val > 1000:
                                        data['quote_total'] = f"${amt}"
                                        f.write(f" ← SELECTED!\n")
                                        break
                                    f.write("\n")
                            else:
                                f.write("  ✗ SUB-TOTAL: not found\n")
                            f.write("\n")
                        
                        # Final result
                        f.write("=" * 60 + "\n")
                        f.write(f"FINAL RESULT: {data.get('quote_total', 'NOT FOUND')}\n")
                        f.write("=" * 60 + "\n")
                
                print(f"DEBUG: Andersen extraction debug written to {debug_file.absolute()}")
                
                # Pattern 1: Detect label group (TAX, LABOR, FREIGHT, SUB-TOTAL) followed by value group
                label_group_match = re.search(r'TAX:\s*\n\s*LABOR:\s*\n\s*FREIGHT:\s*\n\s*SUB[-\s]*TOTAL:\s*\n', text, re.IGNORECASE)
                if label_group_match:
                    # Get text after the label group and extract 4 amounts (TAX, LABOR, FREIGHT, SUB-TOTAL)
                    after_labels = text[label_group_match.end():label_group_match.end()+150]
                    amounts = re.findall(r'\$?([\d,]+\.\d{2})', after_labels[:100])
                    if len(amounts) >= 4:
                        data['quote_total'] = f"${amounts[3]}"  # SUB-TOTAL is 4th position
                
                # Pattern 2: Find TAX: label, then get 4th amount after it
                if not data.get('quote_total'):
                    tax_match = re.search(r'TAX:\s*\n', text, re.IGNORECASE)
                    if not tax_match:
                        tax_match = re.search(r'TAX:', text, re.IGNORECASE)
                    
                    if tax_match:
                        after_tax = text[tax_match.end():]
                        amounts = re.findall(r'\$?([\d,]+\.\d{2})', after_tax[:300])
                        
                        for i in range(len(amounts) - 1):
                            curr_val = float(amounts[i].replace(',', ''))
                            next_val = float(amounts[i+1].replace(',', '')) if i+1 < len(amounts) else 0
                            if 100 < curr_val < 1000 and next_val > 1000:
                                data['quote_total'] = f"${amounts[i+1]}"
                                break
                
                # Pattern 3: Look for SUB-TOTAL label and get next large amount
                if not data.get('quote_total'):
                    subtotal_pos = re.search(r'SUB[-\s]*TOTAL:', text, re.IGNORECASE)
                    if subtotal_pos:
                        after_subtotal = text[subtotal_pos.end():subtotal_pos.end()+150]
                        amounts = re.findall(r'\$?([\d,]+\.\d{2})', after_subtotal)
                        for amt in amounts:
                            if float(amt.replace(',', '')) > 1000:
                                data['quote_total'] = f"${amt}"
                                break
                
                # Fallback to TOTAL if SUB-TOTAL not found
                if not data.get('quote_total'):
                    total_match = re.search(r'^\s*TOTAL:\s*\$?([\d,]+\.\d{2})', text, re.IGNORECASE | re.MULTILINE)
                    if total_match:
                        data['quote_total'] = f"${total_match.group(1)}"
                
                # Extract PO number (CUSTOMER PO#)
                if not data.get('po_number'):
                    po_match = re.search(r'CUSTOMER\s+PO#[^\n]*\n\s*(\d{2}-\d{5}(?:TA)?)', text, re.IGNORECASE)
                    if po_match:
                        data['po_number'] = po_match.group(1).strip()
                
                # Extract product type and details from line items
                # Look for E-Series, A-Series, 400 Series, etc.
                if 'e-series' in text.lower() or 'e series' in text.lower():
                    data['series'] = 'E-Series'
                    if 'door' in text.lower():
                        data['product_type'] = 'Door'
                    elif 'window' in text.lower():
                        data['product_type'] = 'Window'
                elif 'a-series' in text.lower() or 'a series' in text.lower():
                    data['series'] = 'A-Series'
                elif '400 series' in text.lower():
                    data['series'] = '400 Series'
                
                # Extract size (e.g., "60 3/4 x 83 1/2")
                if not data.get('size'):
                    size_match = re.search(r'(?:French|Door|Window)[,\s]+(\d+\s+\d+/\d+\s*x\s*\d+\s+\d+/\d+)', text, re.IGNORECASE)
                    if size_match:
                        data['size'] = size_match.group(1).strip()
                
                # Extract finish information (Black 2604, etc.)
                if not data.get('exterior_finish'):
                    finish_match = re.search(r'(Black|White|Bronze|Terratone|Sandtone)\s+\d{4}\s+Exterior', text, re.IGNORECASE)
                    if finish_match:
                        data['exterior_finish'] = finish_match.group(1).title()
                
                # Extract glass type (Low-E4 SmartSun, Tempered, Argon, etc.)
                if not data.get('glass'):
                    glass_types = []
                    if 'low-e' in text.lower():
                        if 'low-e4' in text.lower():
                            glass_types.append('Low-E4')
                        else:
                            glass_types.append('Low-E')
                    if 'smartsun' in text.lower():
                        glass_types.append('SmartSun')
                    if 'tempered' in text.lower():
                        glass_types.append('Tempered')
                    if 'argon' in text.lower():
                        glass_types.append('Argon')
                    if glass_types:
                        data['glass'] = ', '.join(glass_types)
            
            elif 'emtek' in text.lower():
                data['vendor'] = 'Emtek'
            
            # Generic finish extraction
            ext_match = re.search(r'Ext[^/\n]*?\s+(White|Black|Bronze|Tan|Clay|Beige)', text, re.IGNORECASE)
            if ext_match:
                data['exterior_finish'] = ext_match.group(1)
            
            int_match = re.search(r'Int[^/\n]*?\s+(White|Black|Bronze|Tan|Clay|Beige|Oak|Cherry)', text, re.IGNORECASE)
            if int_match:
                data['interior_finish'] = int_match.group(1)
            
            # Generic size extraction
            size_match = re.search(r'(?:RO|Size)\s*:?\s*(\d+["\']?\s*x\s*\d+["\']?)', text, re.IGNORECASE)
            if size_match:
                data['size'] = size_match.group(1)
            
            # Generic glass extraction
            glass_keywords = ['Low-E', 'Tempered', 'Dual Glaze', 'Triple Glaze', 'Argon']
            found_glass = []
            for keyword in glass_keywords:
                if keyword.lower() in text.lower():
                    found_glass.append(keyword)
            if found_glass:
                data['glass'] = ', '.join(found_glass)
        
        # Merge filename metadata (prefer filename data over OCR for these fields)
        is_architectural_schedule = (data.get('vendor') == 'Architectural Plan') or (
            'door schedule' in text_lower or 'window schedule' in text_lower
        )
        for key, value in filename_data.items():
            if key == 'vendor' and value:
                vendor_normalized = re.sub(r'\s+', '', str(value)).strip().lower()
                if vendor_normalized in ('unknown', 'unknownvendor', 'unknown_vendor'):
                    continue
                if is_architectural_schedule:
                    # Keep Architectural Plan vendor for schedule documents.
                    continue

            if value and not data.get(key):
                # Only use filename data if OCR didn't find anything
                data[key] = value
            elif key in ['customer_name', 'vendor', 'quote_date', 'document_type'] and value:
                # For these critical fields, always prefer filename if available
                if key == 'customer_name':
                    normalized = re.sub(r'\s+', ' ', str(value)).strip().lower()
                    # Do not overwrite extracted OCR name with generic filename placeholders
                    if normalized in ('unknown customer', 'unknown'):
                        continue
                if key == 'vendor' and is_architectural_schedule:
                    continue
                data[key] = value
                print(f"Using filename data for {key}: {value}")

        # Enforce PO format globally: 55-55555 or 55-55555TA
        if data.get('po_number'):
            data['po_number'] = self._normalize_po_number(data.get('po_number', ''))
        
        return data
                
    def clear_results(self):
        """Clear all results"""
        self.result_text.clear()
        self.structured_text.clear()
        self.detailed_results = []
        self.status_label.setText("Results cleared.")
    
    def clean_text(self, text):
        """Clean up OCR text for better readability"""
        # Remove multiple consecutive blank lines
        lines = text.split('\n')
        cleaned_lines = []
        prev_blank = False
        
        for line in lines:
            stripped = line.strip()
            # Keep line if it has content, or if it's the first blank line
            if stripped:
                cleaned_lines.append(line.rstrip())  # Keep original indentation
                prev_blank = False
            elif not prev_blank:
                cleaned_lines.append('')
                prev_blank = True
        
        text = '\n'.join(cleaned_lines)
        
        # Fix common OCR issues
        # Remove isolated single characters that are likely OCR noise
        text = re.sub(r'\n[^\w\n]\n', '\n', text)
        
        # Fix multiple spaces
        text = re.sub(r' {2,}', ' ', text)
        
        return text.strip()

    def _strip_debug_ocr_sections(self, text: str) -> str:
        """Remove internal debug OCR table dumps from user-facing raw text display."""
        if not text:
            return text

        lines = text.splitlines()
        cleaned = []
        skipping_debug = False

        for line in lines:
            header = line.strip()
            is_debug_header = bool(re.match(r'^---\s*(LEFT|RIGHT)\s+TABLE\s*---$', header, re.IGNORECASE))
            if is_debug_header:
                skipping_debug = True
                continue

            if skipping_debug:
                next_section_header = bool(re.match(r'^---\s*(?!LEFT\s+TABLE|RIGHT\s+TABLE).+---$', header, re.IGNORECASE))
                if next_section_header:
                    skipping_debug = False
                    cleaned.append(line)
                continue

            cleaned.append(line)

        result = "\n".join(cleaned)
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()

    def _strip_display_line_numbers(self, text: str) -> str:
        """Remove display-only line-number prefixes like '0123 | ' from OCR text."""
        if not text:
            return text
        lines = text.splitlines()
        cleaned = [re.sub(r'^\s*\d{1,6}\s*\|\s?', '', line) for line in lines]
        return "\n".join(cleaned).strip()

    def _get_text_for_parsing(self) -> str:
        """Return unnumbered OCR text for extraction/export logic."""
        raw = (self._last_parse_text or "").strip()
        if raw:
            return raw
        return self._strip_display_line_numbers(self.result_text.toPlainText())

    def _add_line_numbers(self, text: str) -> str:
        """Prefix each displayed OCR line with a line number for quick reference."""
        if not text:
            return text

        lines = text.splitlines()
        width = max(3, len(str(len(lines))))
        numbered = [f"{idx:0{width}d} | {line}" for idx, line in enumerate(lines, start=1)]
        return "\n".join(numbered)

    def _normalize_schedule_line(self, line: str) -> str:
        """Normalize common OCR artifacts found in schedule tables."""
        line = line.upper()
        line = line.replace('”', '"').replace('“', '"').replace('’', "'").replace('‘', "'")
        line = line.replace('°', '"').replace('`', "'")
        line = line.replace('|', '1')
        line = re.sub(r'\s+', ' ', line).strip()

        # Common OCR substitutions around dimensions
        line = re.sub(r'\bG(?=\s*[-\'])', '6', line)
        line = re.sub(r'\bO(?=\s*[-\'])', '0', line)
        line = re.sub(r'\bI(?=\s*[-\'])', '1', line)
        line = line.replace(' XOX ', ' X 6-0" ')
        line = line.replace(' SUDER', ' SLIDER')
        line = line.replace(' ENGRESS', ' EGRESS')
        line = line.replace(' BIPASS', ' BYPASS')
        return line

    def _standardize_dimension_token(self, token: str) -> str:
        """Convert dimension-like OCR token to normalized N-N\" X N-N\" form."""
        cleaned = token.upper()
        cleaned = cleaned.replace('”', '"').replace('“', '"').replace('°', '"')
        cleaned = cleaned.replace("'", '-')
        cleaned = cleaned.replace('.', '-')
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        cleaned = re.sub(r'\s*[X×]\s*', ' X ', cleaned)
        cleaned = re.sub(r'\s*"\s*', '"', cleaned)
        cleaned = re.sub(r'\bG(?=\s*[-\d])', '6', cleaned)
        cleaned = re.sub(r'\bO(?=\s*[-\d])', '0', cleaned)
        cleaned = re.sub(r'\bI(?=\s*[-\d])', '1', cleaned)

        parts = cleaned.split(' X ')
        if len(parts) != 2:
            return cleaned

        def normalize_side(side: str) -> str:
            side = side.strip()
            side = re.sub(r'(\d)A\b', r'\g<1>8', side)
            side = re.sub(r'(\d)S\b', r'\g<1>5', side)
            m_split = re.search(r'(\d{1,2})\s+(\d{1,2})(?!\d)', side)
            if m_split:
                return f"{int(m_split.group(1))}-{int(m_split.group(2))}\""
            side = re.sub(r'[^0-9\-" ]', '', side)
            m = re.search(r'(\d{1,2})\s*[- ]\s*(\d{1,2})', side)
            if m:
                return f"{int(m.group(1))}-{int(m.group(2))}\""

            # Handle inch-only OCR values (e.g., 22" -> 1-10", 80" -> 6-8").
            m_single_inches = re.fullmatch(r'\s*(\d{1,3})\s*"?\s*', side)
            if m_single_inches:
                value = int(m_single_inches.group(1))
                if value >= 12:
                    return f"{value // 12}-{value % 12}\""
                return f"0-{value}\""

            m2 = re.search(r'(\d{1,2})', side)
            if m2:
                return f"{int(m2.group(1))}-0\""
            return side

        return f"{normalize_side(parts[0])} X {normalize_side(parts[1])}"

    def _infer_schedule_item_type(self, line: str) -> str:
        """Infer schedule item type from a line."""
        if 'BYPASS' in line:
            return 'BYPASS DOOR'
        if 'SKYLIGHT' in line:
            return 'OPERABLE SKYLIGHT'
        if 'AWNING' in line:
            return 'AWNING'
        if 'FIXED' in line:
            return 'FIXED'
        if ('SLIDER' in line or 'SUDER' in line) and ('EGRESS' in line or 'ENGRESS' in line):
            return 'SLIDER - EGRESS'
        if 'SLIDER' in line or 'SUDER' in line:
            return 'SLIDER'
        if 'DOOR' in line:
            return 'DOOR'
        if 'WINDOW' in line:
            return 'WINDOW'
        return 'ITEM'

    def _infer_schedule_item_type_for_index(self, lines, index: int) -> str:
        """Infer item type using local line-first context to avoid distant bleed."""
        current = lines[index] if 0 <= index < len(lines) else ''
        direct = self._infer_schedule_item_type(current)
        if direct != 'ITEM':
            return direct

        # Only immediate neighbors to reduce mislabeling from repeated note blocks.
        for offset in (-1, 1):
            pos = index + offset
            if 0 <= pos < len(lines):
                neighbor = lines[pos]
                neighbor_type = self._infer_schedule_item_type(neighbor)
                if neighbor_type in ('AWNING', 'FIXED', 'BYPASS DOOR', 'OPERABLE SKYLIGHT'):
                    return neighbor_type
                if neighbor_type == 'SLIDER - EGRESS' and ('SLIDER' in current or 'SUDER' in current):
                    return neighbor_type
                if neighbor_type == 'SLIDER' and ('SLIDER' in current or 'SUDER' in current):
                    return neighbor_type

        return 'ITEM'

    def _extract_dimension_tokens(self, line: str):
        """Extract likely dimension tokens from noisy OCR schedule lines."""
        tokens = []

        pattern_full = re.compile(
            r'([0-9GOIAS]{1,2}\s*[-\'\"]?\s*[0-9GOIAS]{0,2}\s*["\']?\s*[X×]\s*[0-9GOIAS]{1,2}\s*[-\'\"]?\s*[0-9GOIAS]{0,2}\s*["\']?)',
            re.IGNORECASE
        )
        tokens.extend(pattern_full.findall(line))

        # Split-feet form e.g. "2 8" X 6-8" -> treat first side as 2-8
        pattern_split = re.compile(
            r'((?:\d{1,2}\s+\d{1,2}|\d{1,2}\s*[-\']\s*\d{1,2})\s*["\']?\s*[X×]\s*(?:\d{1,2}\s+\d{1,2}|\d{1,2}\s*[-\']\s*\d{1,2})\s*["\']?)',
            re.IGNORECASE
        )
        tokens.extend(pattern_split.findall(line))

        # Compact no-hyphen pattern e.g. 30" X20"
        pattern_compact = re.compile(
            r'((?<!\d)\d{2}\s*["\']?\s*[X×]\s*\d{2}(?!\d))',
            re.IGNORECASE
        )
        tokens.extend(pattern_compact.findall(line))

        deduped = []
        seen = set()
        for token in tokens:
            key = re.sub(r'\s+', ' ', token.strip().upper())
            if key and key not in seen:
                seen.add(key)
                deduped.append(token)
        return deduped

    def _schedule_group_from_type(self, item_type: str) -> str:
        """Map item type to schedule group for key fields output."""
        normalized = (item_type or '').upper()
        if 'DOOR' in normalized or 'BYPASS' in normalized:
            return 'Door'
        if 'SKYLIGHT' in normalized:
            return 'Window'
        if any(token in normalized for token in ('SLIDER', 'AWNING', 'FIXED', 'WINDOW')):
            return 'Window'
        return 'Unknown'

    def _is_door_like_size(self, standardized_size: str) -> bool:
        """Heuristic: detect common door-size dimensions (e.g., 2-8 x 6-8, 3-0 x 6-8)."""
        match = re.match(r'^(\d{1,2})-(\d{1,2})" X (\d{1,2})-(\d{1,2})"$', standardized_size)
        if not match:
            return False

        width_ft, width_in, height_ft, height_in = map(int, match.groups())
        width_total = (width_ft * 12) + width_in
        height_total = (height_ft * 12) + height_in

        return 24 <= width_total <= 60 and 78 <= height_total <= 102

    def _extract_operation_tokens_from_line(self, line: str):
        """Extract one or more schedule operation tokens from a normalized line."""
        tokens = []
        upper = (line or '').upper()

        if 'OPERABLE SKYLIGHT' in upper or 'SKYLIGHT' in upper:
            tokens.append('OPERABLE SKYLIGHT')
        if 'XOX' in upper and ('SLIDER' in upper or 'SUDER' in upper):
            tokens.append('XOX SLIDER')
        if ('SLIDER' in upper or 'SUDER' in upper) and ('EGRESS' in upper or 'ENGRESS' in upper):
            tokens.append('SLIDER - EGRESS')
        elif 'SLIDER' in upper or 'SUDER' in upper:
            tokens.append('SLIDER')
        if 'FIXED' in upper:
            tokens.append('FIXED')
        if 'AWNING' in upper:
            tokens.append('AWNING')
        if 'BYPASS' in upper:
            tokens.append('BYPASS DOOR')
        if 'VENT' in upper and 'DOOR' in upper:
            tokens.append('VENT DOOR')

        return tokens

    def _find_section_bounds(self, lines, header):
        """Find [start, end) bounds for a schedule section."""
        start = -1
        for idx, line in enumerate(lines):
            if header in line:
                start = idx
                break
        if start == -1:
            return None

        end = len(lines)
        for idx in range(start + 1, len(lines)):
            line = lines[idx]
            if (header == 'WINDOW SCHEDULE' and 'DOOR SCHEDULE' in line) or \
               (header == 'DOOR SCHEDULE' and 'WINDOW SCHEDULE' in line):
                end = idx
                break
        # Keep section local to reduce note bleed.
        end = min(end, start + 220)
        return (start, end)

    def _reconstruct_rows_from_schedule_sections(self, normalized_lines):
        """Fallback reconstruction using ordered rows inside WINDOW/DOOR schedule sections."""
        reconstructed = []

        window_bounds = self._find_section_bounds(normalized_lines, 'WINDOW SCHEDULE')
        door_bounds = self._find_section_bounds(normalized_lines, 'DOOR SCHEDULE')

        if window_bounds:
            ws, we = window_bounds
            window_dims = []
            window_ops = []
            for line in normalized_lines[ws:we]:
                if not line:
                    continue
                # Ignore header labels and long note text lines.
                if any(marker in line for marker in ('NUMBER', 'WIDTH X HEIGHT', 'HEADER HEIGHT', 'ADDITIONAL NOTES', 'CONTRACTOR')):
                    continue

                for dim in self._extract_dimension_tokens(line):
                    standardized = self._standardize_dimension_token(dim)
                    if not re.match(r'^\d{1,2}-\d{1,2}" X \d{1,2}-\d{1,2}"$', standardized):
                        continue
                    # Window rows should exclude door-like dimensions in this section.
                    if self._is_door_like_size(standardized):
                        continue
                    window_dims.append(standardized)

                window_ops.extend(self._extract_operation_tokens_from_line(line))

            # Keep first 10 canonical window rows if available; preserve duplicates.
            symbol_suffixes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K']
            max_rows = min(len(window_dims), max(0, len(symbol_suffixes)))
            for idx in range(max_rows):
                operation = window_ops[idx] if idx < len(window_ops) else 'ITEM'
                row = {
                    'schedule_type': 'Window',
                    'symbol': f"1{symbol_suffixes[idx]}",
                    'size': window_dims[idx],
                    'operation': operation,
                }
                reconstructed.append(row)

        if door_bounds:
            ds, de = door_bounds
            door_dims = []
            int_ext_values = []
            wall_values = []
            notes_values = []
            op_values = []

            for line in normalized_lines[ds:de]:
                if not line:
                    continue
                if any(marker in line for marker in ('NUMBER', 'WIDTH X HEIGHT', 'WALL', 'ADDITIONAL NOTES', 'CONTRACTOR')):
                    continue

                for dim in self._extract_dimension_tokens(line):
                    standardized = self._standardize_dimension_token(dim)
                    if not re.match(r'^\d{1,2}-\d{1,2}" X \d{1,2}-\d{1,2}"$', standardized):
                        continue
                    if self._is_door_like_size(standardized):
                        door_dims.append(standardized)

                if re.search(r'\bEXT\b', line):
                    int_ext_values.append('EXT')
                elif re.search(r'\bINT\b', line):
                    int_ext_values.append('INT')

                wall_match = re.search(r'\b(\d\s*[-/]\s*\d(?:/\d)?\"?)\b', line)
                if wall_match:
                    wall_values.append(wall_match.group(1).replace(' ', ''))

                ops = self._extract_operation_tokens_from_line(line)
                op_values.extend(ops)
                if 'BYPASS DOOR' in ops:
                    notes_values.append('BYPASS DOOR')
                if 'VENT DOOR' in ops:
                    notes_values.append('VENT DOOR')

            max_rows = min(len(door_dims), 6)
            for idx in range(max_rows):
                row = {
                    'schedule_type': 'Door',
                    'symbol': str(101 + idx),
                    'size': door_dims[idx],
                    'operation': op_values[idx] if idx < len(op_values) else 'DOOR',
                }
                if idx < len(int_ext_values):
                    row['int_ext'] = int_ext_values[idx]
                if idx < len(wall_values):
                    row['wall'] = wall_values[idx]
                if idx < len(notes_values):
                    row['notes'] = notes_values[idx]
                reconstructed.append(row)

        return reconstructed

    def _extract_schedule_symbol_rows(self, normalized_lines):
        """Extract schedule rows using symbol patterns like 1A..1K and 101..106."""
        rows = []
        current_section = None

        for line in normalized_lines:
            if not line:
                continue
            if 'WINDOW SCHEDULE' in line:
                current_section = 'Window'
                continue
            if 'DOOR SCHEDULE' in line:
                current_section = 'Door'
                continue

            # Window symbols (1A..1K) or OCR variants (IA..IK)
            window_match = re.match(r'^\s*(?:1|I)\s*([A-K])\b', line)
            is_window_symbol = window_match is not None
            # Door symbols (101..199) or OCR variants (I01..I99)
            door_match = re.match(r'^\s*((?:1|I)\s*\d{2})\b', line)
            is_door_symbol = door_match is not None

            if not is_window_symbol and not is_door_symbol:
                continue

            dims = self._extract_dimension_tokens(line)
            if not dims:
                continue

            item_type = self._infer_schedule_item_type(line)
            schedule_type = current_section or ('Door' if is_door_symbol else 'Window')

            symbol = ''
            if is_window_symbol:
                symbol = f"1{window_match.group(1)}"
            elif is_door_symbol:
                numeric = re.sub(r'\s+', '', door_match.group(1).replace('I', '1'))
                symbol = numeric

            # Width x Height is typically the first dimension token in the row.
            chosen_size = ''
            header_height = ''
            for dim in dims:
                standardized = self._standardize_dimension_token(dim)
                if re.match(r'^\d{1,2}-\d{1,2}" X \d{1,2}-\d{1,2}"$', standardized):
                    if not chosen_size:
                        chosen_size = standardized
                    elif not header_height:
                        header_height = standardized
            if not chosen_size:
                continue

            # For windows, header height is usually second token and effectively a single height value.
            if schedule_type == 'Window' and header_height:
                hh_match = re.match(r'^\d{1,2}-\d{1,2}" X (\d{1,2}-\d{1,2}")$', header_height)
                if hh_match:
                    header_height = hh_match.group(1)

            # Door schedule row metadata
            int_ext = ''
            if re.search(r'\bEXT\b', line):
                int_ext = 'EXT'
            elif re.search(r'\bINT\b', line):
                int_ext = 'INT'

            wall = ''
            wall_match = re.search(r'\b(\d\s*[-/]\s*\d(?:/\d)?\"?)\b', line)
            if wall_match:
                wall = wall_match.group(1).replace(' ', '')

            notes = ''
            if 'BYPASS' in line:
                notes = 'BYPASS DOOR'
            elif 'VENT' in line:
                notes = 'VENT DOOR'
            elif 'XOX' in line:
                notes = 'XOX SLIDER'
            elif 'SKYLIGHT' in line:
                notes = 'OPERABLE SKYLIGHT'

            if schedule_type == 'Door' and item_type == 'ITEM':
                item_type = 'DOOR'

            row = {
                'schedule_type': schedule_type,
                'size': chosen_size,
                'operation': item_type,
            }
            if symbol:
                row['symbol'] = symbol
            if schedule_type == 'Window' and header_height:
                row['header_height'] = header_height
            if schedule_type == 'Door' and int_ext:
                row['int_ext'] = int_ext
            if schedule_type == 'Door' and wall:
                row['wall'] = wall
            if notes:
                row['notes'] = notes
            rows.append(row)

        return rows

    def _extract_schedule_items_for_key_fields(self, text: str):
        """Extract normalized schedule rows for structured key fields output."""
        if not text:
            return []

        items = []
        seen = set()
        normalized_lines = [self._normalize_schedule_line(line) for line in text.splitlines()]
        current_schedule_section = None
        has_door_schedule_header = any('DOOR SCHEDULE' in line for line in normalized_lines)
        has_window_schedule_header = any('WINDOW SCHEDULE' in line for line in normalized_lines)
        note_markers = (
            'ADDITIONAL NOTES', 'CONTRACTOR', 'NFRC', 'GLAZING', 'AREAS UNDER',
            'ACCORDING TO CBC', 'LABELS', 'ROUGH OPENING', 'TESTING', 'AAMAS'
        )

        # Seed rows from explicit schedule symbols first for best table fidelity.
        for row in self._extract_schedule_symbol_rows(normalized_lines):
            dedupe_key = (
                row.get('schedule_type', ''),
                row.get('symbol', ''),
                row.get('size', ''),
                row.get('operation', ''),
                row.get('int_ext', ''),
                row.get('wall', ''),
                row.get('stud', '')
            )
            if dedupe_key not in seen:
                seen.add(dedupe_key)
                items.append(row)

        for idx, line in enumerate(normalized_lines):
            if not line:
                continue

            if 'DOOR SCHEDULE' in line:
                current_schedule_section = 'Door'
                continue
            if 'WINDOW SCHEDULE' in line:
                current_schedule_section = 'Window'
                continue

            dims = self._extract_dimension_tokens(line)
            if not dims:
                continue

            item_type = self._infer_schedule_item_type_for_index(normalized_lines, idx)
            context_parts = []
            for offset in (-1, 0, 1):
                pos = idx + offset
                if 0 <= pos < len(normalized_lines):
                    context_parts.append(normalized_lines[pos])
            context_line = ' '.join(context_parts)

            location = ''
            if re.search(r'\bINT\b', context_line):
                location = 'INT'
            elif re.search(r'\bEXT\b', context_line):
                location = 'EXT'

            stud_match = re.search(r'\b(\d{1,2}\s*[-/]\s*\d(?:/\d)?\"?)\b', context_line)
            stud = stud_match.group(1).replace(' ', '') if stud_match else ''

            if item_type == 'ITEM' and any(marker in context_line for marker in note_markers):
                continue

            for dim in dims:
                standardized = self._standardize_dimension_token(dim)
                if not re.match(r'^\d{1,2}-\d{1,2}" X \d{1,2}-\d{1,2}"$', standardized):
                    continue

                inferred_group = self._schedule_group_from_type(item_type)
                schedule_group = inferred_group if inferred_group != 'Unknown' else (current_schedule_section or 'Unknown')

                # Drop implausible door dimensions caused by OCR fragments
                # (e.g., 10-0" x 6-8") while keeping realistic door sizes.
                if schedule_group == 'Door' and not self._is_door_like_size(standardized):
                    continue

                # If type/section is ambiguous, infer from size to avoid dropping door rows.
                if schedule_group in ('Unknown', 'Window') and self._is_door_like_size(standardized):
                    if has_door_schedule_header:
                        schedule_group = 'Door'
                        if item_type == 'ITEM':
                            item_type = 'DOOR'

                row = {
                    'schedule_type': schedule_group,
                    'size': standardized,
                    'operation': item_type,
                }
                if location:
                    row['int_ext'] = location
                if stud:
                    row['stud'] = stud

                dedupe_key = (
                    row.get('schedule_type', ''),
                    row.get('symbol', ''),
                    row.get('size', ''),
                    row.get('operation', ''),
                    row.get('int_ext', ''),
                    row.get('wall', ''),
                    row.get('stud', '')
                )
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                items.append(row)

        # Prefer rows with explicit operation over generic ITEM for same schedule_type+symbol/size.
        best = {}
        for row in items:
            key = (
                row.get('schedule_type', ''),
                row.get('symbol', '') or row.get('size', '')
            )
            existing = best.get(key)
            if existing is None:
                best[key] = row
                continue
            existing_is_generic = existing.get('operation', 'ITEM') == 'ITEM'
            current_is_specific = row.get('operation', 'ITEM') != 'ITEM'
            if existing_is_generic and current_is_specific:
                best[key] = row

        # Final fallback: if a door schedule exists but no door rows were found,
        # promote door-like unknown/window rows into Door.
        rows = list(best.values())

        # Keep rows ordered by section and symbol where available.
        def sort_key(row):
            section_rank = 0 if row.get('schedule_type') == 'Window' else 1
            symbol = row.get('symbol', '')
            if symbol:
                return (section_rank, 0, symbol)
            return (section_rank, 1, row.get('size', ''))

        rows.sort(key=sort_key)

        has_door_rows = any(r.get('schedule_type') == 'Door' for r in rows)
        if has_door_schedule_header and has_window_schedule_header and not has_door_rows:
            for row in rows:
                size = row.get('size', '')
                if self._is_door_like_size(size):
                    row['schedule_type'] = 'Door'
                    if row.get('operation') == 'ITEM':
                        row['operation'] = 'DOOR'

        # If extraction is clearly undercounting, use section-based ordered reconstruction.
        reconstructed_rows = self._reconstruct_rows_from_schedule_sections(normalized_lines)
        if len(reconstructed_rows) > len(rows):
            rows = reconstructed_rows

        return rows

    def _build_schedule_summary(self, text: str) -> str:
        """Build a condensed schedule summary from noisy OCR text."""
        upper = (text or '').upper()
        if 'DOOR SCHEDULE' not in upper and 'WINDOW SCHEDULE' not in upper:
            return ''

        rows = self._extract_schedule_items_for_key_fields(text)
        if not rows:
            return ''

        lines = ["=" * 50, "PARSED SCHEDULE (OCR CLEANUP)", "=" * 50]
        for idx, row in enumerate(rows, 1):
            dimension = row.get('size', '')
            item_type = row.get('operation', 'ITEM')
            schedule_type = row.get('schedule_type', 'Unknown')
            symbol = row.get('symbol', '')
            symbol_prefix = f"{symbol} " if symbol else ''
            lines.append(f"{idx:>2}. [{schedule_type}] {symbol_prefix}{dimension:<16}  {item_type}")
        lines.append("=" * 50)
        return "\n".join(lines)
    
    def update_font_size(self):
        """Update the font size in text areas"""
        size = self.font_size_spin.value()
        font = QFont("Consolas", size)
        self.result_text.setFont(font)
        self.structured_text.setFont(font)
    
    def search_text(self):
        """Search for text in the results"""
        search_term = self.search_box.text()
        if not search_term:
            return
        
        # Search in current tab
        current_widget = self.result_tabs.currentWidget()
        if isinstance(current_widget, QTextEdit):
            # Find next occurrence
            found = current_widget.find(search_term)
            if not found:
                # Wrap around to beginning
                cursor = current_widget.textCursor()
                cursor.movePosition(QTextCursor.Start)
                current_widget.setTextCursor(cursor)
                found = current_widget.find(search_term)
                
            if found:
                self.status_label.setText(f"Found: {search_term}")
            else:
                self.status_label.setText(f"Not found: {search_term}")
    
    def extract_fields(self, text):
        """Extract common fields from document text"""
        fields = {}
        
        # Common patterns
        patterns = {
            'Quote Number': r'Quote\s*(?:Number|#|No\.?)\s*:?\s*([A-Z0-9_-]+)',
            'PO Number': r'PO\s*(?:Number|#|No\.?)\s*:?\s*([A-Z0-9_-]+)',
            'Customer': r'Customer\s*:?\s*([^\n]+)',
            'Invoice': r'Invoice\s*(?:Number|#|No\.?)\s*:?\s*([A-Z0-9_-]+)',
            'Date': r'(?:Date|Created Date|Modified Date)\s*:?\s*(\d{1,2}/\d{1,2}/\d{4})',
            'Total': r'(?:Total|Amount|Price)\s*:?\s*\$?([\d,]+\.?\d{0,2})',
            'Phone': r'(?:Phone|Tel|Mobile)\s*:?\s*([\d\(\)\s-]+)',
            'Email': r'(?:Email|E-mail)\s*:?\s*([\w.-]+@[\w.-]+\.[a-z]{2,})',
            'Address': r'Address\s*:?\s*([^\n]+)',
        }
        
        for field_name, pattern in patterns.items():
            try:
                matches = re.findall(pattern, text, re.IGNORECASE | re.MULTILINE)
                if matches:
                    # Store all matches
                    if len(matches) == 1:
                        fields[field_name] = matches[0].strip()
                    else:
                        for i, match in enumerate(matches):
                            fields[f"{field_name} {i+1}"] = match.strip()
            except re.error:
                continue  # Skip patterns that fail
        
        return fields
    
    def show_extracted_fields(self, fields):
        """Display extracted fields in structured format"""
        if not fields:
            self.structured_text.setText("No common fields detected.\n\nTip: Use the 'Find' feature to search for specific information.")
            return
        
        output = "=" * 50 + "\n"
        output += "EXTRACTED KEY FIELDS\n"
        output += "=" * 50 + "\n\n"
        
        for field_name, value in fields.items():
            output += f"{field_name:.<30} {value}\n"
        
        output += "\n" + "=" * 50 + "\n"
        output += "\nTip: Use the search box to find specific text in the Raw Text tab."
        
        self.structured_text.setText(output)
    
    def show_vendor_data(self, data):
        """Display vendor-specific extracted data in structured format"""
        output = "=" * 50 + "\n"
        output += "VENDOR-SPECIFIC EXTRACTED DATA\n"
        output += "=" * 50 + "\n\n"
        
        # Display in organized sections
        if data.get('vendor'):
            output += f"Vendor: {data['vendor']}\n"
            output += "-" * 50 + "\n\n"
        
        # Quote Information
        output += "QUOTE INFORMATION:\n"
        if data.get('quote_number'):
            output += f"  Quote Number: {data['quote_number']}\n"
        if data.get('quote_date'):
            output += f"  Quote Date: {data['quote_date']}\n"
        if data.get('quote_total'):
            output += f"  Quote Total (Net): {data['quote_total']}\n"
        if data.get('po_number'):
            output += f"  PO Number: {data['po_number']}\n"
        output += "\n"
        
        # Customer Information
        output += "CUSTOMER INFORMATION:\n"
        if data.get('customer_name'):
            output += f"  Customer Name: {data['customer_name']}\n"
        if data.get('customer_number'):
            output += f"  Customer Number: {data['customer_number']}\n"
        if data.get('phone'):
            output += f"  Phone: {data['phone']}\n"
        if data.get('email'):
            output += f"  Email: {data['email']}\n"
        output += "\n"
        
        # Product Information
        output += "PRODUCT INFORMATION:\n"
        if data.get('product_type'):
            output += f"  Product Type: {data['product_type']}\n"
        if data.get('series'):
            output += f"  Series: {data['series']}\n"
        if data.get('model'):
            output += f"  Model: {data['model']}\n"
        if data.get('door_style'):
            output += f"  Door Style: {data['door_style']}\n"
        if data.get('door_configuration'):
            output += f"  Door Configuration: {data['door_configuration']}\n"
        if data.get('size'):
            output += f"  Size: {data['size']}\n"
        if data.get('thickness'):
            output += f"  Thickness: {data['thickness']}\n"
        if data.get('operation_style'):
            output += f"  Operation Style: {data['operation_style']}\n"
        if data.get('swing') or data.get('handing'):
            output += f"  Handing: {data.get('swing') or data.get('handing')}\n"
        if data.get('total_windows'):
            output += f"  Total Windows: {data['total_windows']}\n"
        if data.get('total_doors'):
            output += f"  Total Doors: {data['total_doors']}\n"
        if data.get('line_items'):
            try:
                parsed_items = json.loads(data['line_items'])
                if isinstance(parsed_items, list) and parsed_items:
                    qty_total = 0
                    for item in parsed_items:
                        if not isinstance(item, dict):
                            continue
                        qty_val = item.get('quantity', 1)
                        try:
                            qty_total += int(qty_val)
                        except Exception:
                            qty_total += 1
                    output += f"  Units Parsed: {len(parsed_items)} lines / {qty_total} qty\n"
            except Exception:
                pass
        output += "\n"
        
        # Finish Information
        if data.get('exterior_finish') or data.get('interior_finish'):
            output += "FINISH INFORMATION:\n"
            if data.get('exterior_finish'):
                output += f"  Exterior Finish: {data['exterior_finish']}\n"
            if data.get('interior_finish'):
                output += f"  Interior Finish: {data['interior_finish']}\n"
            output += "\n"
        
        # Glass Information
        if data.get('glass'):
            output += "GLASS INFORMATION:\n"
            output += f"  Glass: {data['glass']}\n"
            output += "\n"
        
        # Hardware Information
        if data.get('hardware'):
            output += "HARDWARE INFORMATION:\n"
            output += f"  Hardware: {data['hardware']}\n"
            output += "\n"

        # Schedule Items (window/door rows for architectural plans)
        if data.get('schedule_items'):
            try:
                schedule_rows = json.loads(data['schedule_items'])
                if isinstance(schedule_rows, list) and schedule_rows:
                    output += f"SCHEDULE ITEMS ({len(schedule_rows)} rows):\n"
                    output += "-" * 50 + "\n"
                    for index, row in enumerate(schedule_rows, 1):
                        schedule_type = row.get('schedule_type', 'Unknown')
                        symbol = row.get('symbol', '')
                        size = row.get('size', '')
                        header_height = row.get('header_height', '')
                        operation = row.get('operation', '')
                        int_ext = row.get('int_ext', '')
                        wall = row.get('wall', '')
                        stud = row.get('stud', '')
                        notes = row.get('notes', '')
                        output += f"\nRow {index}:\n"
                        output += f"  Type: {schedule_type}\n"
                        if symbol:
                            output += f"  Symbol: {symbol}\n"
                        if size:
                            output += f"  Size: {size}\n"
                        if header_height:
                            output += f"  Header Height: {header_height}\n"
                        if operation:
                            output += f"  Operation: {operation}\n"
                        if int_ext:
                            output += f"  Int/Ext: {int_ext}\n"
                        if wall:
                            output += f"  Wall: {wall}\n"
                        if stud:
                            output += f"  Stud: {stud}\n"
                        if notes:
                            output += f"  Notes: {notes}\n"
                    output += "\n"
            except Exception:
                pass
        
        # Line Items
        if data.get('line_items'):
            try:
                items = json.loads(data['line_items'])
                output += f"LINE ITEMS ({len(items)} items):\n"
                output += "-" * 50 + "\n"
                for i, item in enumerate(items, 1):
                    output += f"\nItem {i}:\n"
                    for key, value in item.items():
                        if value:
                            output += f"  {key}: {value}\n"
                output += "\n"
            except:
                output += "LINE ITEMS:\n"
                output += f"  {data['line_items']}\n\n"
        
        output += "=" * 50 + "\n"
        output += "\nTip: Click 'Export to Order Tracker' to import this data."
        
        self.structured_text.setText(output)


def main():
    """Main entry point"""
    # Check if pytesseract is installed
    if pytesseract is None:
        print("=" * 60)
        print("ERROR: pytesseract is not installed!")
        print("=" * 60)
        print("\nPlease install it using:")
        print("  pip install pytesseract pillow")
        print("\nAlso install Tesseract OCR:")
        print("  Download from: https://github.com/UB-Mannheim/tesseract/wiki")
        print("=" * 60)
        sys.exit(1)
    
    app = QApplication(sys.argv)
    app.setStyle('Fusion')
    
    window = OCRTool()
    window.show()
    
    sys.exit(app.exec_())


if __name__ == '__main__':
    main()
