"""Order note endpoints: list, add, update, delete."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from core import dict_from_row, get_db_connection

notes_bp = Blueprint('notes', __name__)


@notes_bp.route('/api/orders/<int:order_id>/notes', methods=['GET'])
def get_notes_endpoint(order_id):
    """Get all notes for an order"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("""
            SELECT id, note, created_at
            FROM order_notes
            WHERE order_id = ?
            ORDER BY id DESC
        """, (order_id,))
        rows = cursor.fetchall()
        conn.close()

        notes = [dict_from_row(row) for row in rows]

        return jsonify({
            'success': True,
            'notes': notes,
            'count': len(notes)
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@notes_bp.route('/api/orders/<int:order_id>/notes', methods=['POST'])
def add_note_endpoint(order_id):
    """Add a note to an order"""
    try:
        data = request.get_json()

        if not data or not data.get('note'):
            return jsonify({
                'success': False,
                'error': 'Note text is required'
            }), 400

        note_text = data['note'].strip()
        if not note_text:
            return jsonify({
                'success': False,
                'error': 'Note cannot be empty'
            }), 400

        # Check if order exists
        conn = get_db_connection()
        cursor = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404

        # Add note
        from datetime import datetime
        now = datetime.now().isoformat()
        cursor = conn.execute("""
            INSERT INTO order_notes (order_id, note, created_at)
            VALUES (?, ?, ?)
        """, (order_id, note_text, now))
        conn.commit()

        note_id = cursor.lastrowid
        conn.close()

        return jsonify({
            'success': True,
            'note': {
                'id': note_id,
                'note': note_text,
                'created_at': now
            },
            'message': 'Note added successfully'
        }), 201

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@notes_bp.route('/api/notes/<int:note_id>', methods=['PUT'])
def update_note_endpoint(note_id):
    """Update an existing note"""
    try:
        data = request.get_json()

        if not data or not data.get('note'):
            return jsonify({
                'success': False,
                'error': 'Note text is required'
            }), 400

        note_text = data['note'].strip()
        if not note_text:
            return jsonify({
                'success': False,
                'error': 'Note cannot be empty'
            }), 400

        conn = get_db_connection()

        # Check if note exists
        cursor = conn.execute("SELECT id FROM order_notes WHERE id = ?", (note_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Note not found'
            }), 404

        # Update note
        conn.execute("UPDATE order_notes SET note = ? WHERE id = ?", (note_text, note_id))
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Note updated successfully'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@notes_bp.route('/api/notes/<int:note_id>', methods=['DELETE'])
def delete_note_endpoint(note_id):
    """Delete a note"""
    try:
        conn = get_db_connection()

        # Check if note exists
        cursor = conn.execute("SELECT id FROM order_notes WHERE id = ?", (note_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Note not found'
            }), 404

        # Delete note
        conn.execute("DELETE FROM order_notes WHERE id = ?", (note_id,))
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Note deleted successfully'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
