"""
OCR Parser for Order Intake Forms
Parses scanned order intake forms and extracts structured data
"""

import re
from typing import Dict, Optional, Any

class IntakeFormParser:
    """Parse OCR text from order intake forms into structured data"""
    
    def __init__(self, ocr_text: str):
        self.text = ocr_text
        self.lines = [line.strip() for line in ocr_text.split('\n') if line.strip()]
        
    def parse(self) -> Dict[str, Any]:
        """Parse the OCR text and extract all fields"""
        data = {
            'customer_info': self._parse_customer_info(),
            'product_type': self._detect_product_type(),
        }
        
        if data['product_type'] == 'door':
            data['specifications'] = self._parse_door_specs()
        elif data['product_type'] == 'window':
            data['specifications'] = self._parse_window_specs()
        
        return data
    
    def _detect_product_type(self) -> str:
        """Detect if this is a door or window form"""
        text_lower = self.text.lower()
        
        door_keywords = ['door order intake', 'door specifications', 'jamb size', 'swing:', 'boring:']
        window_keywords = ['window order intake', 'window specifications', 'window type:', 'frame material:']
        
        door_score = sum(1 for kw in door_keywords if kw in text_lower)
        window_score = sum(1 for kw in window_keywords if kw in text_lower)
        
        return 'door' if door_score > window_score else 'window'
    
    def _parse_customer_info(self) -> Dict[str, str]:
        """Extract customer information fields"""
        info = {}
        
        # Customer Name
        info['customer_name'] = self._extract_field_value(
            r'customer\s*name\s*[:：]\s*(.+?)(?:\n|phone|email|$)', 
            'customer name'
        )
        
        # Phone Number
        info['phone'] = self._extract_field_value(
            r'phone\s*(?:number)?\s*[:：]\s*(.+?)(?:\n|email|project|$)',
            'phone number'
        )
        
        # Email
        info['email'] = self._extract_field_value(
            r'email\s*[:：]\s*(.+?)(?:\n|project|$)',
            'email'
        )
        
        # Project Name
        info['project_name'] = self._extract_field_value(
            r'project\s*name\s*[:：]\s*(.+?)(?:\n|door|window|$)',
            'project name'
        )
        
        return {k: v for k, v in info.items() if v}
    
    def _parse_door_specs(self) -> Dict[str, Any]:
        """Extract door specification fields"""
        specs = {}
        
        # Quantity
        qty_text = self._extract_field_value(r'quantity\s*[:：]\s*(.+?)(?:\n|door|$)', 'quantity')
        if qty_text:
            try:
                specs['quantity'] = int(re.search(r'\d+', qty_text).group())
            except:
                specs['quantity'] = 1
        
        # Door Size
        specs['size'] = self._extract_field_value(
            r'door\s*size\s*[:：]\s*(.+?)(?:\n|rough|$)',
            'door size'
        )
        
        # Rough Opening
        specs['rough_opening'] = self._extract_field_value(
            r'rough\s*opening\s*[:：]\s*(.+?)(?:\n|configuration|$)',
            'rough opening'
        )
        
        # Configuration
        specs['door_configuration'] = self._extract_field_value(
            r'configuration\s*[:：]\s*(.+?)(?:\n|jamb|$)',
            'configuration'
        )
        
        # Jamb Size
        specs['jamb'] = self._extract_field_value(
            r'jamb\s*size\s*[:：]\s*(.+?)(?:\n|swing|$)',
            'jamb size'
        )
        
        # Swing
        specs['swing'] = self._extract_field_value(
            r'swing\s*[:：]\s*(.+?)(?:\n|hinge|$)',
            'swing'
        )
        
        # Hinges
        specs['hinges'] = self._extract_field_value(
            r'hinges?\s*[:：]\s*(.+?)(?:\n|trim|$)',
            'hinges'
        )
        
        # Trim
        specs['trim'] = self._extract_field_value(
            r'trim\s*[:：]\s*(.+?)(?:\n|boring|$)',
            'trim'
        )
        
        # Boring
        specs['boring'] = self._extract_field_value(
            r'boring\s*[:：]\s*(.+?)(?:\n|sill|$)',
            'boring'
        )
        
        # Sill & Bottom
        specs['sill'] = self._extract_field_value(
            r'sill\s*(?:&|and)?\s*bottom\s*[:：]\s*(.+?)(?:\n|color|$)',
            'sill'
        )
        
        # Color / Finish
        specs['color'] = self._extract_field_value(
            r'color\s*(?:/|and)?\s*finish\s*[:：]\s*(.+?)(?:\n|glass|$)',
            'color'
        )
        
        # Glass Type
        specs['glass'] = self._extract_field_value(
            r'glass\s*type\s*[:：]\s*(.+?)(?:\n|hardware|$)',
            'glass type'
        )
        
        # Hardware
        specs['hardware'] = self._extract_field_value(
            r'hardware\s*[:：]\s*(.+?)(?:\n|q-?lon|$)',
            'hardware'
        )
        
        # Q-LON
        qlon_text = self._extract_field_value(r'q-?lon\s*[:：]\s*(.+?)(?:\n|customer|$)', 'q-lon')
        specs['qlon'] = self._parse_yes_no(qlon_text)
        
        # Customer Brought Door
        customer_door_text = self._extract_field_value(
            r'customer\s*brought\s*door\s*[:：]\s*(.+?)(?:\n|special|$)',
            'customer brought door'
        )
        specs['customer_brought_door'] = self._parse_yes_no(customer_door_text)
        
        # Special Conditions
        specs['special_conditions'] = self._extract_field_value(
            r'special\s*conditions\s*[:：]\s*(.+?)(?:\n\n|form\s*generated|$)',
            'special conditions',
            multiline=True
        )
        
        return {k: v for k, v in specs.items() if v is not None}
    
    def _parse_window_specs(self) -> Dict[str, Any]:
        """Extract window specification fields"""
        specs = {}
        
        # Quantity
        qty_text = self._extract_field_value(r'quantity\s*[:：]\s*(.+?)(?:\n|window|$)', 'quantity')
        if qty_text:
            try:
                specs['quantity'] = int(re.search(r'\d+', qty_text).group())
            except:
                specs['quantity'] = 1
        
        # Window Type
        specs['window_type'] = self._extract_field_value(
            r'window\s*type\s*[:：]\s*(.+?)(?:\n|size|$)',
            'window type'
        )
        
        # Size Type
        specs['size_type'] = self._extract_field_value(
            r'size\s*type\s*[:：]\s*(.+?)(?:\n|width|$)',
            'size type'
        )
        
        # Width
        specs['window_width'] = self._extract_field_value(
            r'width\s*[:：]\s*(.+?)(?:\n|height|$)',
            'width'
        )
        
        # Height
        specs['window_height'] = self._extract_field_value(
            r'height\s*[:：]\s*(.+?)(?:\n|rough|$)',
            'height'
        )
        
        # Rough Opening
        specs['rough_opening'] = self._extract_field_value(
            r'rough\s*opening\s*[:：]\s*(.+?)(?:\n|frame|$)',
            'rough opening'
        )
        
        # Frame Material
        specs['window_frame'] = self._extract_field_value(
            r'frame\s*material\s*[:：]\s*(.+?)(?:\n|color|$)',
            'frame material'
        )
        
        # Color / Finish
        specs['color'] = self._extract_field_value(
            r'color\s*(?:/|and)?\s*finish\s*[:：]\s*(.+?)(?:\n|glass|$)',
            'color'
        )
        
        # Glass Type
        specs['glass'] = self._extract_field_value(
            r'glass\s*type\s*[:：]\s*(.+?)(?:\n|grid|$)',
            'glass type'
        )
        
        # Grid Pattern
        specs['window_grid'] = self._extract_field_value(
            r'grid\s*pattern\s*[:：]\s*(.+?)(?:\n|screen|$)',
            'grid pattern'
        )
        
        # Include Screen
        screen_text = self._extract_field_value(
            r'include\s*screen\s*[:：]\s*(.+?)(?:\n|special|$)',
            'include screen'
        )
        specs['window_screen'] = self._parse_yes_no(screen_text)
        
        # Special Conditions
        specs['special_conditions'] = self._extract_field_value(
            r'special\s*conditions\s*[:：]\s*(.+?)(?:\n\n|form\s*generated|$)',
            'special conditions',
            multiline=True
        )
        
        return {k: v for k, v in specs.items() if v is not None}
    
    def _extract_field_value(self, pattern: str, field_name: str, multiline: bool = False) -> Optional[str]:
        """Extract a field value using regex pattern"""
        flags = re.IGNORECASE | re.DOTALL if multiline else re.IGNORECASE
        
        match = re.search(pattern, self.text, flags)
        if match:
            value = match.group(1).strip()
            # Clean up common OCR artifacts
            value = re.sub(r'\s+', ' ', value)
            value = value.replace('&nbsp;', '').strip()
            
            # If empty or just punctuation/whitespace, return None
            if not value or value in ['_', '-', '—', '–', '□', '☐']:
                return None
            
            return value
        
        return None
    
    def _parse_yes_no(self, text: Optional[str]) -> bool:
        """Parse yes/no or checkbox values"""
        if not text:
            return False
        
        text_lower = text.lower()
        
        # Check for explicit yes
        if any(word in text_lower for word in ['yes', 'y', 'checked', '☑', '✓', '✔', 'x']):
            return True
        
        # Check for explicit no
        if any(word in text_lower for word in ['no', 'n', 'unchecked', '☐']):
            return False
        
        return False

def parse_intake_form(ocr_text: str) -> Dict[str, Any]:
    """Convenience function to parse intake form OCR text"""
    parser = IntakeFormParser(ocr_text)
    return parser.parse()

# Example usage
if __name__ == "__main__":
    # Example OCR text from a door form
    sample_text = """
    DOOR ORDER INTAKE FORM
    
    CUSTOMER INFORMATION
    Customer Name: John Smith
    Phone Number: 555-123-4567
    Email: john.smith@email.com
    Project Name: Smith Residence Remodel
    
    DOOR SPECIFICATIONS
    Quantity: 2
    Door Size: 3068
    Rough Opening: 38x82
    Configuration: Prehung
    Jamb Size: 4-9/16"
    Swing: LH
    Hinges: 4.5" Square Corner
    Trim: 2-1/4" Casing
    Boring: Single
    Sill & Bottom: Oak sill
    Color / Finish: White
    Glass Type: Clear
    Hardware: Lever
    Q-LON: Yes
    Customer Brought Door: No
    Special Conditions: Rush order - needed by end of week
    """
    
    result = parse_intake_form(sample_text)
    
    import json
    print(json.dumps(result, indent=2))
