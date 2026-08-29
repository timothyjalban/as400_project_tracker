import 'package:flutter/material.dart';
import '../models/customer_order.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import 'order_success_screen.dart';
import 'order_form_screen.dart';

class ReviewOrderScreen extends StatefulWidget {
  final CustomerOrder order;
  final int? orderId; // Order ID if editing existing order
  final bool isEdit; // Flag indicating if this is an edit

  const ReviewOrderScreen(
      {super.key, required this.order, this.orderId, this.isEdit = false});

  @override
  State<ReviewOrderScreen> createState() => _ReviewOrderScreenState();
}

class _ReviewOrderScreenState extends State<ReviewOrderScreen> {
  final _storageService = StorageService();
  bool _isSubmitting = false;
  bool _isRequestingQuote = false;
  String? _errorMessage;

  /// Best-effort: attempts to build one real Or-Pac quote covering every
  /// door item in the order. Returns null on any failure (no door items,
  /// network error, automation failure) rather than throwing -- order
  /// submission has already succeeded by the time this runs, so a quote
  /// hiccup shouldn't block or alarm the customer, just mean the quote
  /// snapshot is omitted.
  Future<Map<String, dynamic>?> _tryRequestOrepacQuote(dynamic orderId) async {
    final doorItems =
        widget.order.items.where((item) => item.product == 'Door').toList();
    if (doorItems.isEmpty) {
      return null;
    }
    setState(() => _isRequestingQuote = true);
    try {
      final result = await ApiService.requestOrepacQuote(
        customerName: widget.order.customerName,
        phone: widget.order.phone,
        email: widget.order.email,
        orderId: int.tryParse(orderId?.toString() ?? ''),
        items: doorItems,
      );
      return result;
    } catch (e) {
      print('Or-Pac quote request failed (order was still submitted): $e');
      return null;
    } finally {
      if (mounted) setState(() => _isRequestingQuote = false);
    }
  }

  Future<void> _submitOrder() async {
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      print(
          'DEBUG ReviewOrderScreen: isEdit=${widget.isEdit}, orderId=${widget.orderId}');

      // If editing existing order, update it
      if (widget.isEdit && widget.orderId != null) {
        print('DEBUG: Updating existing order ${widget.orderId}');
        final response =
            await ApiService.updateOrder(widget.orderId!, widget.order);

        if (response['success'] == true) {
          final quote = await _tryRequestOrepacQuote(response['order_id']);
          if (mounted) {
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(
                builder: (context) => OrderSuccessScreen(
                  orderId: response['order_id']?.toString() ?? 'Unknown',
                  order: widget.order,
                  quoteNumber: quote?['quote_number']?.toString(),
                  quoteItems: (quote?['items'] as List<dynamic>?)
                      ?.cast<Map<String, dynamic>>(),
                ),
              ),
            );
          }
        } else {
          setState(() {
            _errorMessage = response['error'] ?? 'Failed to update order';
            _isSubmitting = false;
          });
        }
        return;
      }

      // For new orders (no orderId), skip draft check and proceed with submission
      if (widget.orderId == null) {
        // New order - proceed directly with submission
        final response = await ApiService.submitOrder(widget.order);

        if (response['success'] == true) {
          // Clear draft on success (both local and server)
          await _storageService.clearDraftByPhone(widget.order.phone);
          final quote = await _tryRequestOrepacQuote(response['order_id']);

          if (mounted) {
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(
                builder: (context) => OrderSuccessScreen(
                  orderId: response['order_id']?.toString() ?? 'Unknown',
                  order: widget.order,
                  quoteNumber: quote?['quote_number']?.toString(),
                  quoteItems: (quote?['items'] as List<dynamic>?)
                      ?.cast<Map<String, dynamic>>(),
                ),
              ),
            );
          }
        } else {
          setState(() {
            _errorMessage = response['error'] ?? 'Failed to submit order';
            _isSubmitting = false;
          });
        }
        return;
      }

      // For existing orders, check if the draft still exists (duplicate submission prevention)
      final draftCheck = await ApiService.loadDraft(widget.order.phone);

      if (draftCheck == null) {
        // Draft doesn't exist - it was already submitted from another device
        // Show dialog to allow editing the submitted order
        setState(() {
          _isSubmitting = false;
        });
        _showEditSubmittedOrderDialog();
        return;
      }

      // Draft exists, proceed with submission
      final response = await ApiService.submitOrder(widget.order);

      if (response['success'] == true) {
        // Clear draft on success (both local and server)
        await _storageService.clearDraftByPhone(widget.order.phone);
        final quote = await _tryRequestOrepacQuote(response['order_id']);

        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (context) => OrderSuccessScreen(
                orderId: response['order_id']?.toString() ?? 'Unknown',
                order: widget.order,
                quoteNumber: quote?['quote_number']?.toString(),
                quoteItems: (quote?['items'] as List<dynamic>?)
                    ?.cast<Map<String, dynamic>>(),
              ),
            ),
          );
        }
      } else {
        setState(() {
          _errorMessage = response['error'] ?? 'Failed to submit order';
          _isSubmitting = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Connection error: ${e.toString()}';
        _isSubmitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Review Order'),
      ),
      body: _isSubmitting
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Submitting your order...',
                      style: TextStyle(fontSize: 16)),
                ],
              ),
            )
          : _isRequestingQuote
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('Building your quote...',
                          style: TextStyle(fontSize: 16)),
                      SizedBox(height: 4),
                      Text('This can take a couple of minutes.',
                          style: TextStyle(fontSize: 13, color: Colors.grey)),
                    ],
                  ),
                )
              : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_errorMessage != null) ...[
                  Card(
                    color: Colors.red.shade50,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline, color: Colors.red),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              _errorMessage!,
                              style: const TextStyle(color: Colors.red),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                _buildCustomerInfoCard(),
                const SizedBox(height: 16),
                _buildItemsCard(),
                if (widget.order.notes?.isNotEmpty ?? false) ...[
                  const SizedBox(height: 16),
                  _buildNotesCard(),
                ],
                if (widget.order.photos.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _buildPhotosCard(),
                ],
                const SizedBox(height: 80),
              ],
            ),
      bottomNavigationBar: _isSubmitting || _isRequestingQuote
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(context),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                        ),
                        child: const Text('Edit Order',
                            style: TextStyle(fontSize: 16)),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: _submitOrder,
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          backgroundColor: Colors.green,
                        ),
                        child: Text(
                          widget.isEdit ? 'Update Order' : 'Request Quote',
                          style: const TextStyle(
                              fontSize: 16, color: Colors.white),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildCustomerInfoCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.person, color: Colors.blue),
                SizedBox(width: 8),
                Text(
                  'Customer Information',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const Divider(height: 24),
            _buildInfoRow('Name', widget.order.customerName),
            const SizedBox(height: 8),
            _buildInfoRow('Phone', widget.order.phone),
            if (widget.order.email?.isNotEmpty ?? false) ...[
              const SizedBox(height: 8),
              _buildInfoRow('Email', widget.order.email ?? ''),
            ],
            if (widget.order.project?.isNotEmpty ?? false) ...[
              const SizedBox(height: 8),
              _buildInfoRow('Project', widget.order.project ?? ''),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildItemsCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.list_alt, color: Colors.blue),
                const SizedBox(width: 8),
                const Text(
                  'Items',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.blue,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    widget.order.items.length.toString(),
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            ...widget.order.items.asMap().entries.map((entry) {
              final index = entry.key;
              final item = entry.value;
              return Padding(
                padding: EdgeInsets.only(
                    bottom: index < widget.order.items.length - 1 ? 16 : 0),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            item.product == 'Door'
                                ? Icons.door_front_door
                                : Icons.window,
                            size: 20,
                            color: Colors.blue,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              item.displayName,
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 16),
                            ),
                          ),
                        ],
                      ),
                      if (item.product == 'Door') ...[
                        if (item.jambSize != null)
                          _buildItemDetail('Jamb', item.jambSize!),
                        if (item.swing != null)
                          _buildItemDetail('Swing', item.swing!),
                        if (item.finishType != null)
                          _buildItemDetail('Finish', item.finishType!),
                        if (item.glassTint != null)
                          _buildItemDetail('Glass', item.glassTint!),
                        if (item.hardwareOption != null)
                          _buildItemDetail('Hardware', item.hardwareOption!),
                      ] else ...[
                        if (item.windowType != null)
                          _buildItemDetail('Type', item.windowType!),
                        if (item.width != null && item.height != null)
                          _buildItemDetail(
                              'Size', '${item.width} × ${item.height}'),
                        if (item.frameMaterial != null)
                          _buildItemDetail('Frame', item.frameMaterial!),
                        if (item.color != null)
                          _buildItemDetail('Color', item.color!),
                        if (item.gridPattern != null)
                          _buildItemDetail('Grid', item.gridPattern!),
                      ],
                      if (item.specialConditions != null &&
                          item.specialConditions!.isNotEmpty)
                        _buildItemDetail('Notes', item.specialConditions!),
                    ],
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildNotesCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.note, color: Colors.blue),
                SizedBox(width: 8),
                Text(
                  'Additional Notes',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const Divider(height: 24),
            Text(widget.order.notes ?? ''),
          ],
        ),
      ),
    );
  }

  Widget _buildPhotosCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.photo_library, color: Colors.blue),
                const SizedBox(width: 8),
                const Text(
                  'Photos',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.blue,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    widget.order.photos.length.toString(),
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            const Text('Photos will be submitted with your order'),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 80,
          child: Text(
            '$label:',
            style: const TextStyle(
                fontWeight: FontWeight.bold, color: Colors.grey),
          ),
        ),
        Expanded(
          child: Text(value, style: const TextStyle(fontSize: 16)),
        ),
      ],
    );
  }

  Widget _buildItemDetail(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(top: 4, left: 28),
      child: Row(
        children: [
          Text('$label: ',
              style: const TextStyle(fontSize: 13, color: Colors.grey)),
          Text(value, style: const TextStyle(fontSize: 13)),
        ],
      ),
    );
  }

  Future<void> _showEditSubmittedOrderDialog() async {
    return showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Order Already Submitted'),
        content: const Text(
          'This draft has already been submitted. If you would like to edit your request, click below.',
          style: TextStyle(fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context); // Close dialog
              await _loadAndEditSubmittedOrder();
            },
            child: const Text('Click Here to Edit'),
          ),
        ],
      ),
    );
  }

  Future<void> _loadAndEditSubmittedOrder() async {
    setState(() {
      _isSubmitting = true;
    });

    try {
      print(
          'DEBUG: _loadAndEditSubmittedOrder called for phone: ${widget.order.phone}');

      // Get the most recent order for this phone number
      final orderData = await ApiService.getRecentOrder(widget.order.phone);

      print(
          'DEBUG: API response received: ${orderData != null ? "success" : "null"}');

      if (orderData != null && mounted) {
        final order = orderData['order'] as CustomerOrder;
        final orderId = orderData['order_id'] as int;

        print(
            'DEBUG: Loading order for editing - orderId: $orderId, customer: ${order.customerName}, items: ${order.items.length}');

        // Navigate back to order form with the submitted order data
        Navigator.pop(context); // Close review screen
        Navigator.pop(context); // Close current form

        // Open new form with existing order data and order ID
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => OrderFormScreen(
              draft: order,
              orderId: orderId,
              isEdit: true,
            ),
          ),
        );
      } else {
        setState(() {
          _errorMessage =
              'Could not find the submitted order. Please contact support.';
          _isSubmitting = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Error loading order: ${e.toString()}';
        _isSubmitting = false;
      });
    }
  }
}
