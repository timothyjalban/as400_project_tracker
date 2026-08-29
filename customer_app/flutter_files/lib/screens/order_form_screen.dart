import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/customer_order.dart';
import '../models/line_item.dart';
import '../services/storage_service.dart';
import 'add_item_screen.dart';
import 'review_order_screen.dart';
import '../config.dart';

class OrderFormScreen extends StatefulWidget {
  final CustomerOrder? draft;
  final int? orderId; // For editing existing orders
  final bool isEdit; // Flag to indicate editing mode

  const OrderFormScreen(
      {super.key, this.draft, this.orderId, this.isEdit = false});

  @override
  State<OrderFormScreen> createState() => _OrderFormScreenState();
}

class _OrderFormScreenState extends State<OrderFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _customerNameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _projectController = TextEditingController();
  final _notesController = TextEditingController();

  final List<LineItem> _items = [];
  final bool _isLoading = false;
  int? _editingOrderId; // Store order ID if editing

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    if (widget.draft != null) {
      setState(() {
        _customerNameController.text = widget.draft!.customerName;
        _phoneController.text = widget.draft!.phone;
        _emailController.text = widget.draft!.email ?? '';
        _projectController.text = widget.draft!.project ?? '';
        _notesController.text = widget.draft!.notes ?? '';
        _items.clear();
        _items.addAll(widget.draft!.items);
        _editingOrderId = widget.orderId; // Set order ID if editing
      });
      print(
          'DEBUG OrderFormScreen: Loaded ${widget.isEdit ? "order" : "draft"} with ${widget.draft!.items.length} items');
      print(
          'DEBUG OrderFormScreen: isEdit=${widget.isEdit}, orderId=${widget.orderId}, _editingOrderId=$_editingOrderId');
    } else {
      // Load saved customer info after build completes
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final storage = context.read<StorageService>();
        final lastInfo = storage.getLastCustomerInfo();
        setState(() {
          _customerNameController.text = lastInfo['name'] ?? '';
          _phoneController.text = lastInfo['phone'] ?? '';
          _emailController.text = lastInfo['email'] ?? '';
        });
      });
    }
  }

  @override
  void dispose() {
    _customerNameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _projectController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _saveDraft() async {
    if (_customerNameController.text.isEmpty && _items.isEmpty) return;

    final order = CustomerOrder(
      customerName: _customerNameController.text,
      phone: _phoneController.text,
      email: _emailController.text.isNotEmpty ? _emailController.text : null,
      project:
          _projectController.text.isNotEmpty ? _projectController.text : null,
      items: _items,
      notes: _notesController.text.isNotEmpty ? _notesController.text : null,
    );

    final storage = context.read<StorageService>();
    await storage.saveDraft(order);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Draft saved')),
      );
    }
  }

  Future<void> _addItem() async {
    final result = await Navigator.push<LineItem>(
      context,
      MaterialPageRoute(
        builder: (context) => const AddItemScreen(),
      ),
    );

    if (result != null) {
      setState(() {
        _items.add(result);
      });
      if (Config.enableDraftSaving) {
        await _saveDraft();
      }
    }
  }

  Future<void> _editItem(int index) async {
    final result = await Navigator.push<LineItem>(
      context,
      MaterialPageRoute(
        builder: (context) => AddItemScreen(item: _items[index]),
      ),
    );

    if (result != null) {
      setState(() {
        _items[index] = result;
      });
      if (Config.enableDraftSaving) {
        await _saveDraft();
      }
    }
  }

  void _removeItem(int index) {
    setState(() {
      _items.removeAt(index);
    });
    if (Config.enableDraftSaving) {
      _saveDraft();
    }
  }

  void _continueToReview() {
    if (_formKey.currentState!.validate()) {
      if (_items.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please add at least one item')),
        );
        return;
      }

      final order = CustomerOrder(
        customerName: _customerNameController.text.trim(),
        phone: _phoneController.text.trim(),
        email: _emailController.text.trim().isNotEmpty
            ? _emailController.text.trim()
            : null,
        project: _projectController.text.trim().isNotEmpty
            ? _projectController.text.trim()
            : null,
        items: _items,
        notes: _notesController.text.trim().isNotEmpty
            ? _notesController.text.trim()
            : null,
      );

      print(
          'DEBUG OrderFormScreen: Navigating to review - orderId: $_editingOrderId, isEdit: ${widget.isEdit}');

      // Temporary: print the full order JSON (customer name/phone + all
      // items) so it can be fed into scripts/orepac_download_quote.py for
      // testing against real Flutter-produced data. Safe to remove once
      // that's no longer needed.
      print('CustomerOrder JSON: ${jsonEncode(order.toJson())}');

      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => ReviewOrderScreen(
            order: order,
            orderId: _editingOrderId,
            isEdit: widget.isEdit,
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isEdit ? 'Edit Order' : 'New Order'),
        actions: [
          if (Config.enableDraftSaving && !widget.isEdit)
            IconButton(
              icon: const Icon(Icons.save),
              onPressed: _saveDraft,
              tooltip: 'Save Draft',
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Top Section: Customer Information (left) + Add Item Buttons (right)
            LayoutBuilder(
              builder: (context, constraints) {
                // Responsive: stack vertically on small screens, side-by-side on larger screens
                final isWideScreen = constraints.maxWidth > 800;

                if (isWideScreen) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Left: Customer Information (half width)
                      Expanded(
                        child: _buildCustomerInfoCard(),
                      ),
                      const SizedBox(width: 16),
                      // Right: Add Item Buttons (half width)
                      Expanded(
                        child: _buildAddItemButtons(),
                      ),
                    ],
                  );
                } else {
                  return Column(
                    children: [
                      _buildCustomerInfoCard(),
                      const SizedBox(height: 16),
                      _buildAddItemButtons(),
                    ],
                  );
                }
              },
            ),

            const SizedBox(height: 24),

            // Items Section
            const Text(
              'Items',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),

            const SizedBox(height: 12),

            if (_items.isEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    children: [
                      Icon(
                        Icons.inventory_2_outlined,
                        size: 64,
                        color: Colors.grey[400],
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'No items added yet',
                        style: TextStyle(
                          fontSize: 16,
                          color: Colors.grey[600],
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Tap "Add Item" to get started',
                        style: TextStyle(
                          color: Colors.grey[500],
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              ..._items.asMap().entries.map((entry) {
                final index = entry.key;
                final item = entry.value;
                return Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor:
                          item.product == 'Door' ? Colors.green : Colors.blue,
                      child: Icon(
                        item.product == 'Door'
                            ? Icons.door_front_door
                            : Icons.window,
                        color: Colors.white,
                      ),
                    ),
                    title: Text(item.displayName),
                    subtitle: Text(
                      item.product == 'Door'
                          ? 'Size: ${item.size ?? "N/A"} • Jamb: ${item.jambSize ?? "N/A"}'
                          : 'Type: ${item.windowType ?? "N/A"}',
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.edit),
                          onPressed: () => _editItem(index),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete),
                          color: Colors.red,
                          onPressed: () {
                            showDialog(
                              context: context,
                              builder: (context) => AlertDialog(
                                title: const Text('Remove Item'),
                                content: const Text(
                                    'Are you sure you want to remove this item?'),
                                actions: [
                                  TextButton(
                                    onPressed: () => Navigator.pop(context),
                                    child: const Text('Cancel'),
                                  ),
                                  TextButton(
                                    onPressed: () {
                                      Navigator.pop(context);
                                      _removeItem(index);
                                    },
                                    child: const Text(
                                      'Remove',
                                      style: TextStyle(color: Colors.red),
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                );
              }),

            const SizedBox(height: 24),

            // Notes Section
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Additional Notes (Optional)',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _notesController,
                      decoration: const InputDecoration(
                        hintText: 'Enter any special instructions or notes...',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 4,
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Continue Button
            ElevatedButton(
              onPressed: _isLoading ? null : _continueToReview,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: _isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text(
                      'Continue to Review',
                      style: TextStyle(fontSize: 16),
                    ),
            ),

            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomerInfoCard() {
    return Card(
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Customer Information',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _customerNameController,
              decoration: const InputDecoration(
                labelText: 'Customer Name *',
                prefixIcon: Icon(Icons.person),
                border: OutlineInputBorder(),
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Please enter customer name';
                }
                return null;
              },
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _phoneController,
              decoration: const InputDecoration(
                labelText: 'Phone Number *',
                prefixIcon: Icon(Icons.phone),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.phone,
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Please enter phone number';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _emailController,
              decoration: const InputDecoration(
                labelText: 'Email (Optional)',
                prefixIcon: Icon(Icons.email),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _projectController,
              decoration: const InputDecoration(
                labelText: 'Project Name (Optional)',
                prefixIcon: Icon(Icons.work),
                border: OutlineInputBorder(),
              ),
              textCapitalization: TextCapitalization.words,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAddItemButtons() {
    return Card(
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Add Items',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            // Buttons laid out horizontally
            Row(
              children: [
                // Door Button
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => _addItemOfType('Door'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.all(32),
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                      shape: const RoundedRectangleBorder(
                        borderRadius: BorderRadius.zero,
                      ),
                    ),
                    child: const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.door_front_door, size: 64),
                        SizedBox(height: 12),
                        Text(
                          'Add Door',
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Entry, Patio, French',
                          style: TextStyle(fontSize: 14, color: Colors.white70),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                // Window Button
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => _addItemOfType('Window'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.all(32),
                      backgroundColor: Colors.blue,
                      foregroundColor: Colors.white,
                      shape: const RoundedRectangleBorder(
                        borderRadius: BorderRadius.zero,
                      ),
                    ),
                    child: const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.window, size: 64),
                        SizedBox(height: 12),
                        Text(
                          'Add Window',
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Hung, Casement, Sliding',
                          style: TextStyle(fontSize: 14, color: Colors.white70),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _addItemOfType(String productType) async {
    // Navigate to add item screen with pre-selected product type
    final result = await Navigator.push<LineItem>(
      context,
      MaterialPageRoute(
        builder: (context) => AddItemScreen(initialProduct: productType),
      ),
    );

    if (result != null) {
      setState(() {
        _items.add(result);
      });
    }
  }
}
