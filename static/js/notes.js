// Order Tracker - Notes
// Depends on globals from app.js: API_BASE, currentOrder, showToast,
// showError, escapeHtml, and formatDate.
// ===== Notes Functions =====

async function loadNotes(orderId) {
    if (!orderId) {
        document.getElementById('notesSection').style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}/notes`);
        const data = await response.json();
        
        if (data.success) {
            renderNotes(data.notes);
            document.getElementById('notesSection').style.display = 'block';
        } else {
            console.error('Failed to load notes:', data.error);
        }
    } catch (error) {
        console.error('Error loading notes:', error);
    }
}

function renderNotes(notes) {
    const container = document.getElementById('notesList');
    
    if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="notes-empty">No notes yet</div>';
        return;
    }
    
    container.innerHTML = notes.map(note => `
        <div class="note-item" data-note-id="${note.id}">
            <div class="note-content">
                <div class="note-text">${escapeHtml(note.note)}</div>
                <div class="note-date">${formatDate(note.created_at)}</div>
            </div>
            <div class="note-actions">
                <button class="btn-icon" onclick="editNote(${note.id}, \`${escapeHtml(note.note).replace(/`/g, '\\\\`')}\`)" title="Edit">
                    ✏️
                </button>
                <button class="btn-icon btn-icon-danger" onclick="deleteNote(${note.id})" title="Delete">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');
}

async function addNote() {
    if (!currentOrder || !currentOrder.id) return;
    
    const textarea = document.getElementById('newNoteText');
    const noteText = textarea.value.trim();
    
    if (!noteText) {
        showError('Please enter a note');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/orders/${currentOrder.id}/notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ note: noteText })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Note added');
            textarea.value = '';  // Clear textarea
            loadNotes(currentOrder.id);  // Reload notes list
        } else {
            showError(result.error || 'Failed to add note');
        }
    } catch (error) {
        console.error('Error adding note:', error);
        showError('Failed to add note');
    }
}

async function editNote(noteId, currentText) {
    const newText = prompt('Edit note:', currentText);
    
    if (newText === null) return;  // User cancelled
    
    const trimmedText = newText.trim();
    if (!trimmedText) {
        showError('Note cannot be empty');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/notes/${noteId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ note: trimmedText })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Note updated');
            loadNotes(currentOrder.id);  // Reload notes list
        } else {
            showError(result.error || 'Failed to update note');
        }
    } catch (error) {
        console.error('Error updating note:', error);
        showError('Failed to update note');
    }
}

async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/notes/${noteId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Note deleted');
            loadNotes(currentOrder.id);  // Reload notes list
        } else {
            showError(result.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Error deleting note:', error);
        showError('Failed to delete note');
    }
}
