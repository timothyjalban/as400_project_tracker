"""
OCR Parser for Bulk Door/Window Order Forms
Parses table-structured multi-item order forms
"""

import re
from typing import Dict, List, Optional, Any


class BulkFormParser:
    """Parse OCR text from bulk order forms (table format with multiple rows)"""
    
    def __init__(self, ocr_text: str):
        self.text = ocr_text
        self.lines = [line.strip() for line in ocr_text.split('\n') if line.strip()]
        
    def parse(self) -> Dict[str, Any]:
        """Parse the OCR text and extract all fields"""
        data = {
            'form_type': 'bulk_order',
            'customer_info': self._parse_customer_info(),
            'product_type': self._detect_product_type(),
            'items': []
        }
        
        if data['product_type'] == 'door':
            data['items'] = self._parse_door_rows()
        elif data['product_type'] == 'window':
            data['items'] = self._parse_window_rows()
        
        return data
    
    def _detect_product_type(self) -> str:
        """Detect if this is a door or window bulk form"""
        text_lower = self.text.lower()
        
        if 'door order form' in text_lower or 'bulk door' in text_lower:
            return 'door'
        elif 'window order form' in text_lower or 'bulk window' in text_lower:
            return 'window'
        
        # Fallback: check for door-specific vs window-specific column headers
        door_keywords = ['swing', 'jamb', 'boring', 'sill']
        window_keywords = ['frame material', 'grid pattern', 'screen']
        
        door_score = sum(1 for kw in door_keywords if kw in text_lower)
        window_score = sum(1 for kw in window_keywords if kw in text_lower)
        
        return 'door' if door_score > window_score else 'window'
    
    def _parse_customer_info(self) -> Dict[str, str]:
        """Extract customer information from header"""
        info = {}
        
        # Look for customer name in first few lines
        for line in self.lines[:20]:
            line_lower = line.lower()
            
            # Customer Name
            if not info.get('customer_name'):
                match = re.search(r'customer\s*name[:\s]+([A-Za-z\s]+?)(?:\s+phone|$)', line, re.IGNORECASE)
                if match:
                    info['customer_name'] = match.group(1).strip()
            
            # Phone
            if not info.get('phone'):
                match = re.search(r'phone[:\s]+([\d\-\(\)\s]+)', line, re.IGNORECASE)
                if match:
                    info['phone'] = match.group(1).strip()
            
            # Email
            if not info.get('email'):
                match = re.search(r'email[:\s]+([\w\.\-]+@[\w\.\-]+)', line, re.IGNORECASE)
                if match:
                    info['email'] = match.group(1).strip()
            
            # Project
            if not info.get('project_name'):
                match = re.search(r'project[:\s]+([A-Za-z\s\d]+)', line, re.IGNORECASE)
                if match:
                    name = match.group(1).strip()
                    # Clean up common OCR artifacts
                    if name and not name.lower() in ['instructions', 'qty', 'width']:
                        info['project_name'] = name
        
        return info
    
    def _parse_door_rows(self) -> List[Dict[str, Any]]:
        """
        Parse table rows for door specifications
        Expected columns: #, Qty, Width, Height, Rough Opening, Frame Size, Config, 
                         Jamb Size, Swing, Hinges, Boring, Sill & Bottom, 
                         Color/Finish, Glass Type, Hardware, Q-LON, Special Notes
        """
        items = []
        
        # Find where the table data starts (after headers)
        table_start_idx = None
        for i, line in enumerate(self.lines):
            line_lower = line.lower()
            if 'qty' in line_lower and 'width' in line_lower and 'height' in line_lower:
                table_start_idx = i + 1
                break
        
        if table_start_idx is None:
            return items
        
        # Process table rows
        current_row_num = None
        row_data = {}
        
        for line in self.lines[table_start_idx:]:
            # Skip empty lines
            if not line or line.strip() == '':
                continue
            
            # Check if this line starts with a row number (1-20)
            row_match = re.match(r'^(\d{1,2})\s+', line)
            if row_match:
                # Save previous row if it has data
                if current_row_num and self._has_door_data(row_data):
                    items.append(row_data)
                
                # Start new row
                current_row_num = int(row_match.group(1))
                row_data = {'row_number': current_row_num}
                
                # Try to parse the entire row at once
                row_data.update(self._parse_door_row_line(line))
            
            # If we're in a row, try to extract field values from subsequent lines
            elif current_row_num:
                self._extract_door_fields_from_line(line, row_data)
        
        # Add last row if it has data
        if current_row_num and self._has_door_data(row_data):
            items.append(row_data)
        
        return items
    
    def _parse_door_row_line(self, line: str) -> Dict[str, Any]:
        """Try to parse an entire door row from a single line"""
        data = {}
        
        # Remove row number from start
        line = re.sub(r'^\d{1,2}\s+', '', line)
        
        # Split by multiple spaces or pipe characters
        parts = re.split(r'\s{2,}|\|', line)
        parts = [p.strip() for p in parts if p.strip()]
        
        # Map parts to expected columns (after row number)
        # Qty, Width, Height, RO checkbox, Frame checkbox, Config, Jamb, Swing, Hinges,
        # Boring, Sill&Bottom, Color, Glass, Hardware, QLON, Notes
        if len(parts) >= 3:
            # Try to identify key fields
            for i, part in enumerate(parts):
                if re.match(r'^\d+$', part) and not data.get('quantity'):
                    data['quantity'] = int(part)
                elif re.match(r'^\d+["\']?\s*x\s*\d+["\']?', part.lower()) or re.match(r'^\d{4}$', part):
                    if not data.get('size'):
                        data['size'] = part
                elif any(swing in part.upper() for swing in ['LHIS', 'RHIS', 'LHOS', 'RHOS', 'LH', 'RH']):
                    data['swing'] = part
                elif part.upper() in ['PH', 'SLAB', 'PREHUNG']:
                    data['door_configuration'] = part
                elif re.match(r'^\d[\s\-]*\d/\d+', part):  # Jamb size like "4-9/16"
                    data['jamb'] = part
        
        return data
    
    def _extract_door_fields_from_line(self, line: str, row_data: Dict):
        """Extract door-specific fields from a line"""
        line_lower = line.lower()
        
        # Swing direction
        if not row_data.get('swing'):
            for swing in ['LHIS', 'RHIS', 'LHOS', 'RHOS', 'LH', 'RH', 'LEFT', 'RIGHT']:
                if swing.lower() in line_lower:
                    row_data['swing'] = swing
                    break
        
        # Configuration
        if not row_data.get('door_configuration'):
            if 'prehung' in line_lower or 'ph' in line.split():
                row_data['door_configuration'] = 'Prehung'
            elif 'slab' in line_lower:
                row_data['door_configuration'] = 'Slab'
        
        # Boring
        if not row_data.get('boring'):
            if 'single' in line_lower:
                row_data['boring'] = 'Single'
            elif 'double' in line_lower:
                row_data['boring'] = 'Double'
        
        # Hinges
        if not row_data.get('hinges'):
            hinge_match = re.search(r'(us\d+|us\s+\d+)', line_lower)
            if hinge_match:
                row_data['hinges'] = hinge_match.group(1).upper().replace(' ', '')
        
        # Color/Finish
        if not row_data.get('color'):
            color_keywords = ['primed', 'painted', 'stained', 'white', 'clear']
            for color in color_keywords:
                if color in line_lower:
                    row_data['color'] = color.title()
                    break
    
    def _has_door_data(self, row_data: Dict) -> bool:
        """Check if a row has any meaningful door data"""
        # Must have at least quantity or size to be considered valid
        required_fields = ['quantity', 'size', 'swing', 'door_configuration']
        return any(row_data.get(field) for field in required_fields)
    
    def _parse_window_rows(self) -> List[Dict[str, Any]]:
        """Parse table rows for window specifications"""
        # Similar structure to door rows, but different columns
        items = []
        
        # Find table start
        table_start_idx = None
        for i, line in enumerate(self.lines):
            line_lower = line.lower()
            if 'qty' in line_lower and 'window type' in line_lower:
                table_start_idx = i + 1
                break
        
        if table_start_idx is None:
            return items
        
        # TODO: Implement window row parsing similar to door rows
        # For now, return empty list
        
        return items


def parse_bulk_form(ocr_text: str) -> Dict[str, Any]:
    """
    Convenience function to parse bulk order forms
    
    Args:
        ocr_text: Raw OCR text from scanned bulk form
        
    Returns:
        Dictionary containing customer info and list of items
    """
    parser = BulkFormParser(ocr_text)
    return parser.parse()


# Example usage
if __name__ == '__main__':
    sample_text = """
    BULK DOOR ORDER FORM
    
    Customer Name: Tim Alban    Phone: 541-206-2556
    Email: tim.alban@sanlorenzolumber.com    Project: Test
    
    # | Qty | Width | Height | RO | Frame | Config | Jamb | Swing | Hinges | Boring | Sill | Color | Glass | Hardware | QLON | Notes
    1 | 1 | 32 | 80 | [x] | [ ] | PH | 4-9/16 | LHIS | US19 | Single | Primed | | | | |
    """
    
    result = parse_bulk_form(sample_text)
    import json
    print(json.dumps(result, indent=2))
