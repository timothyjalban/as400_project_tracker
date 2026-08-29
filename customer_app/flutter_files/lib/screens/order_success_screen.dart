import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/customer_order.dart';
import '../services/storage_service.dart';
import 'home_screen.dart';
import 'order_form_screen.dart';

class OrderSuccessScreen extends StatelessWidget {
  final String orderId;
  final CustomerOrder order;
  // Populated when the Or-Pac quote automation succeeded alongside order
  // submission -- null if it wasn't attempted or failed (order submission
  // itself still succeeds independently either way). One shared quote
  // number covers every entry in quoteItems (one per door, in order).
  final String? quoteNumber;
  final List<Map<String, dynamic>>? quoteItems;

  const OrderSuccessScreen({
    super.key,
    required this.orderId,
    required this.order,
    this.quoteNumber,
    this.quoteItems,
  });

  double? get _totalPrice {
    if (quoteItems == null || quoteItems!.isEmpty) return null;
    double total = 0;
    bool any = false;
    for (final item in quoteItems!) {
      final parsed = double.tryParse(
          (item['price']?.toString() ?? '').replaceAll(RegExp(r'[^0-9.]'), ''));
      if (parsed != null) {
        total += parsed;
        any = true;
      }
    }
    return any ? total : null;
  }

  Future<void> _handleStartNewOrder(BuildContext context) async {
    // Ask if user wants to save customer info for next time
    final saveInfo = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Save Customer Info?'),
        content: const Text(
            'Would you like to save your contact information for your next order?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('No'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Yes, Save'),
          ),
        ],
      ),
    );

    if (saveInfo == true) {
      final storageService = context.read<StorageService>();
      await storageService.saveLastCustomerInfo(
        name: order.customerName,
        phone: order.phone,
        email: order.email ?? '',
      );
    }

    if (context.mounted) {
      // Go directly to order form with saved info
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (context) => const OrderFormScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.green.shade100,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.check_circle,
                  size: 80,
                  color: Colors.green.shade700,
                ),
              ),
              const SizedBox(height: 32),
              const Text(
                'Order Submitted!',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                'Order ID: #$orderId',
                style: TextStyle(
                  fontSize: 18,
                  color: Colors.grey.shade700,
                ),
              ),
              const SizedBox(height: 32),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      const Icon(Icons.info_outline,
                          size: 48, color: Colors.blue),
                      const SizedBox(height: 16),
                      const Text(
                        'What happens next?',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        (quoteItems?.isNotEmpty ?? false)
                            ? 'Your order has been received and your quote is ready below.'
                            : 'Your order has been received and will be reviewed by our team. We\'ll contact you within 1-2 business days to confirm the details and provide a quote.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 15),
                      ),
                      const SizedBox(height: 16),
                      Divider(color: Colors.grey.shade300),
                      const SizedBox(height: 16),
                      _buildSummaryItem('Customer', order.customerName),
                      const SizedBox(height: 8),
                      _buildSummaryItem('Phone', order.phone),
                      const SizedBox(height: 8),
                      _buildSummaryItem(
                        'Items',
                        '${order.items.length} item${order.items.length != 1 ? 's' : ''}',
                      ),
                    ],
                  ),
                ),
              ),
              if (quoteItems != null && quoteItems!.isNotEmpty) ...[
                const SizedBox(height: 16),
                Card(
                  color: Colors.green.shade50,
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.request_quote,
                                color: Colors.green.shade700),
                            const SizedBox(width: 8),
                            const Text(
                              'Your Quote',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const Spacer(),
                            if (quoteNumber != null)
                              Text(
                                '#$quoteNumber',
                                style: TextStyle(color: Colors.grey.shade700),
                              ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        for (final item in quoteItems!) ...[
                          if (item['description'] != null)
                            Text(item['description'].toString(),
                                style: const TextStyle(fontSize: 14)),
                          if (item['price'] != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 2, bottom: 8),
                              child: Text(
                                item['price'].toString(),
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.green.shade800,
                                ),
                              ),
                            ),
                        ],
                        if (quoteItems!.length > 1 && _totalPrice != null) ...[
                          Divider(color: Colors.green.shade200),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Total',
                                  style: TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w600)),
                              Text(
                                '\$${_totalPrice!.toStringAsFixed(2)}',
                                style: TextStyle(
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.green.shade800,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _handleStartNewOrder(context),
                  icon: const Icon(Icons.add),
                  label: const Text('Submit Another Order'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pushAndRemoveUntil(
                      context,
                      MaterialPageRoute(
                          builder: (context) => const HomeScreen()),
                      (route) => false,
                    );
                  },
                  icon: const Icon(Icons.home),
                  label: const Text('Return to Home'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSummaryItem(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            color: Colors.grey.shade700,
            fontWeight: FontWeight.w500,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}
