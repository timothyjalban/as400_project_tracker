import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/storage_service.dart';
import '../services/api_service.dart';
import '../models/customer_order.dart';
import 'order_form_screen.dart';
import '../config.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('New Order'),
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight,
                ),
                child: IntrinsicHeight(
                  child: Padding(
                    padding: const EdgeInsets.all(20.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Icon(
                          Icons.door_front_door,
                          size: 100,
                          color: Color(0xFF2196F3),
                        ),
                        const SizedBox(height: 40),
                        const Text(
                          'Welcome!',
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'Submit your door and window order quickly and easily',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 60),
                        ElevatedButton.icon(
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) => const OrderFormScreen(),
                              ),
                            );
                          },
                          icon: const Icon(Icons.add),
                          label: const Text(
                            'Create New Order',
                            style: TextStyle(fontSize: 18),
                          ),
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 20),
                          ),
                        ),
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          onPressed: () => _showPhoneNumberDialog(context),
                          icon: const Icon(Icons.phone),
                          label: const Text(
                            'Continue with Phone Number',
                            style: TextStyle(fontSize: 16),
                          ),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                        ),
                        const Spacer(),
                        const Text(
                          'Version ${Config.appVersion}',
                          style: TextStyle(
                            color: Colors.grey,
                            fontSize: 12,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  /// Turns a lookup result (from getRecentOrder/getOrderByNumber/
  /// getOrderByQuoteNumber, all of which return the same shape) into a
  /// CustomerOrder, asks the customer whether to edit it or start fresh,
  /// and navigates accordingly. Returns true if it handled the result
  /// (found something), false if the caller should fall back to the next
  /// lookup step.
  Future<bool> _handleFoundOrder(
    BuildContext context,
    BuildContext dialogContext,
    Map<String, dynamic> result,
  ) async {
    final orderData = result['order'] as CustomerOrder;
    final orderId = result['order_id'];
    final quoteNumber = result['quote_number'] as String?;

    if (dialogContext.mounted) {
      Navigator.pop(dialogContext);
    }
    if (!context.mounted) return true;

    final quoteLine =
        quoteNumber != null ? '\nLast quote: #$quoteNumber' : '';
    final shouldEdit = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Order Found'),
        content: Text('Found order #$orderId.$quoteLine\n\n'
            'Would you like to edit it or start a new order?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('New Order'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Edit Order'),
          ),
        ],
      ),
    );

    if (shouldEdit == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Editing order #$orderId'),
          backgroundColor: Colors.blue,
        ),
      );

      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => OrderFormScreen(
            draft: orderData,
            isEdit: true,
            orderId: orderId,
          ),
        ),
      );
    }
    return true;
  }

  void _showPhoneNumberDialog(BuildContext context) {
    final phoneController = TextEditingController();
    final orderNumberController = TextEditingController();
    final quoteNumberController = TextEditingController();
    bool isLoading = false;

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Find Your Order'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Enter your phone number:'),
              const SizedBox(height: 16),
              TextField(
                controller: phoneController,
                keyboardType: TextInputType.phone,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Phone Number',
                  hintText: '5551234567',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Have a specific order or quote number? Enter one to jump '
                'straight to it -- otherwise we\'ll find your most recent order.',
                style: TextStyle(fontSize: 12, color: Colors.grey),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: orderNumberController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Order Number (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: quoteNumberController,
                decoration: const InputDecoration(
                  labelText: 'Or-Pac Quote Number (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              if (isLoading) ...[
                const SizedBox(height: 16),
                const CircularProgressIndicator(),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: isLoading
                  ? null
                  : () async {
                      final phone = phoneController.text.trim();
                      if (phone.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Please enter a phone number')),
                        );
                        return;
                      }
                      final orderNumberText = orderNumberController.text.trim();
                      final quoteNumberText = quoteNumberController.text.trim();

                      setState(() => isLoading = true);

                      try {
                        // A specific order/quote number takes priority over
                        // drafts and "most recent order" -- the customer
                        // asked for that exact one.
                        if (orderNumberText.isNotEmpty) {
                          final orderId = int.tryParse(orderNumberText);
                          if (orderId == null) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content: Text('Order number must be a number')),
                            );
                            return;
                          }
                          final result =
                              await ApiService.getOrderByNumber(orderId, phone);
                          if (result != null) {
                            await _handleFoundOrder(context, dialogContext, result);
                            return;
                          }
                          if (dialogContext.mounted) Navigator.pop(dialogContext);
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content: Text(
                                      'No order found for that order number and phone number')),
                            );
                          }
                          return;
                        }

                        if (quoteNumberText.isNotEmpty) {
                          final result = await ApiService.getOrderByQuoteNumber(
                              quoteNumberText, phone);
                          if (result != null) {
                            await _handleFoundOrder(context, dialogContext, result);
                            return;
                          }
                          if (dialogContext.mounted) Navigator.pop(dialogContext);
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content: Text(
                                      'No order found for that quote number and phone number')),
                            );
                          }
                          return;
                        }

                        final storage = context.read<StorageService>();

                        // First, try to load a draft
                        final draft = await storage.loadDraftByPhone(phone);

                        if (draft != null) {
                          // Found a draft!
                          print(
                              'DEBUG: Loaded draft with ${draft.items.length} items for $phone');

                          if (dialogContext.mounted) {
                            Navigator.pop(dialogContext);
                          }

                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Loaded your saved draft!'),
                                backgroundColor: Colors.green,
                              ),
                            );

                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) =>
                                    OrderFormScreen(draft: draft),
                              ),
                            );
                          }
                          return;
                        }

                        // No draft, check if there's a recent submitted order
                        final recentOrderResult =
                            await ApiService.getRecentOrder(phone);

                        if (recentOrderResult != null) {
                          final handled = await _handleFoundOrder(
                              context, dialogContext, recentOrderResult);
                          if (handled) return;
                        }

                        // No draft or order, try to look up customer info
                        final customerData =
                            await ApiService.lookupCustomer(phone);

                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext);
                        }

                        if (customerData != null && context.mounted) {
                          // Found previous customer info!
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content:
                                  Text('Welcome back! Pre-filled your info.'),
                              backgroundColor: Colors.green,
                            ),
                          );

                          final order = CustomerOrder(
                            customerName: customerData['customer_name'] ?? '',
                            phone: customerData['phone'] ?? '',
                            email: customerData['email'],
                            project: customerData['project'],
                            items: [],
                            notes: null,
                            photos: [],
                          );

                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (context) =>
                                  OrderFormScreen(draft: order),
                            ),
                          );
                        } else if (context.mounted) {
                          // New customer - start fresh with phone number
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Starting new order'),
                            ),
                          );

                          final order = CustomerOrder(
                            customerName: '',
                            phone: phone,
                            email: null,
                            project: null,
                            items: [],
                            notes: null,
                            photos: [],
                          );

                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (context) =>
                                  OrderFormScreen(draft: order),
                            ),
                          );
                        }
                      } catch (e) {
                        print('DEBUG: Error: $e');
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Error: $e')),
                          );
                        }
                      } finally {
                        setState(() => isLoading = false);
                      }
                    },
              child: const Text('Continue'),
            ),
          ],
        ),
      ),
    );
  }
}
