import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/customer_order.dart';
import '../models/line_item.dart';
import '../config.dart';

class ApiService {
  static Future<Map<String, dynamic>> submitOrder(CustomerOrder order) async {
    try {
      final url = Uri.parse('${Config.apiBaseUrl}/api/orders');
      
      final response = await http.post(
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode(order.toJson()),
      ).timeout(Config.apiTimeout);

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        throw Exception('Failed to submit order: ${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Network error: $e');
    }
  }

  static Future<bool> checkConnection() async {
    try {
      final url = Uri.parse('${Config.apiBaseUrl}/health');
      final response = await http.get(url).timeout(const Duration(seconds: 5));
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  static Future<Map<String, dynamic>?> lookupCustomer(String phone) async {
    try {
      final url = Uri.parse('${Config.apiBaseUrl}/api/customer/$phone');
      final response = await http.get(url).timeout(Config.apiTimeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        if (data['success'] == true) {
          return data;
        }
      }
      return null;
    } catch (e) {
      print('Error looking up customer: $e');
      return null;
    }
  }

  static Future<Map<String, dynamic>> getProductOptions() async {
    try {
      final url = Uri.parse('${Config.apiBaseUrl}/api/products');
      final response = await http.get(url).timeout(Config.apiTimeout);

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        return _getDefaultProductOptions();
      }
    } catch (e) {
      return _getDefaultProductOptions();
    }
  }

  static Map<String, dynamic> _getDefaultProductOptions() {
    return {
      'door_sizes': [
        '1068', '1268', '1468', '1668', '1868', '2068', '2268', '2468',
        '2668', '2868', '3068', '3268', '3468', '3668', '3868',
        '1080', '1280', '1480', '1680', '1880', '2080', '2280', '2480',
        '2680', '2880', '3080', '3280', '3480', '3680', '3880'
      ],
      'jamb_sizes': [
        '4-9/16"', '4-5/8"', '4-11/16"', '5-1/4"', '5-3/8"',
        '6-9/16"', '6-5/8"', '6-11/16"', '7-1/4"'
      ],
      'swing_types': ['LH', 'RH', 'LHR', 'RHR', 'Outswing LH', 'Outswing RH'],
      'colors': ['White', 'Bronze', 'Black', 'Almond'],
      'glass_types': ['Clear', 'Obscure', 'Low-E', 'Tempered'],
      'hardware': ['Standard', 'Lever', 'Knob', 'Deadbolt'],
      'boring': ['Single', 'Double', 'None'],
      'window_types': [
        'Single Hung', 'Double Hung', 'Casement', 'Sliding',
        'Picture', 'Awning', 'Bay', 'Bow'
      ],
      'frame_materials': ['Vinyl', 'Aluminum', 'Wood', 'Composite', 'Fiberglass'],
      'grid_patterns': ['None', 'Colonial', 'Prairie', 'Simulated Divided Light']
    };
  }

  static Future<Map<String, dynamic>> saveDraft(CustomerOrder order) async {
    try {
      final url = Uri.parse('${Config.apiBaseUrl}/api/drafts');
      
      final response = await http.post(
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode(order.toJson()),
      ).timeout(Config.apiTimeout);

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        throw Exception('Failed to save draft: ${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Network error: $e');
    }
  }

  static Future<CustomerOrder?> loadDraft(String phone) async {
    try {
      final url = Uri.parse('${Config.apiBaseUrl}/api/drafts/$phone');
      final response = await http.get(url).timeout(Config.apiTimeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        if (data['draft'] != null) {
          return CustomerOrder.fromJson(data['draft'] as Map<String, dynamic>);
        }
      }
      return null;
    } catch (e) {
      print('Error loading draft: $e');
      return null;
    }
  }

  static Future<bool> deleteDraft(String phone) async {
    try {
      final url = Uri.parse('${Config.apiBaseUrl}/api/drafts/$phone');
      final response = await http.delete(url).timeout(Config.apiTimeout);
      return response.statusCode == 200;
    } catch (e) {
      print('Error deleting draft: $e');
      return false;
    }
  }
  static Map<String, dynamic>? _parseOrderLookupBody(String body) {
    final data = jsonDecode(body) as Map<String, dynamic>;
    if (data['success'] != true || data['order'] == null) return null;
    return {
      'order_id': data['order_id'],
      'order': CustomerOrder.fromJson(data['order'] as Map<String, dynamic>),
      'quote_number': data['quote_number'],
      'price': data['price'],
      'description': data['description'],
    };
  }

  static Future<Map<String, dynamic>?> getRecentOrder(String phone) async {
    try {
      print('DEBUG API: getRecentOrder called for phone: $phone');
      final url = Uri.parse('${Config.apiBaseUrl}/api/orders/recent/$phone');
      final response = await http.get(url).timeout(Config.apiTimeout);
      if (response.statusCode == 200) {
        return _parseOrderLookupBody(response.body);
      }
      return null;
    } catch (e) {
      print('Error getting recent order: $e');
      return null;
    }
  }

  /// Looks up a specific order by the tracker's own order number. [phone]
  /// must match the order's phone number -- this can't be used to look up
  /// someone else's order just by guessing a number.
  static Future<Map<String, dynamic>?> getOrderByNumber(
      int orderId, String phone) async {
    try {
      final url = Uri.parse(
          '${Config.apiBaseUrl}/api/orders/by-order-number/$orderId?phone=${Uri.encodeQueryComponent(phone)}');
      final response = await http.get(url).timeout(Config.apiTimeout);
      if (response.statusCode == 200) {
        return _parseOrderLookupBody(response.body);
      }
      return null;
    } catch (e) {
      print('Error getting order by number: $e');
      return null;
    }
  }

  /// Looks up a specific order by its Or-Pac quote number, same
  /// phone-number requirement as [getOrderByNumber].
  static Future<Map<String, dynamic>?> getOrderByQuoteNumber(
      String quoteNumber, String phone) async {
    try {
      final url = Uri.parse(
          '${Config.apiBaseUrl}/api/orders/by-quote-number/${Uri.encodeComponent(quoteNumber)}?phone=${Uri.encodeQueryComponent(phone)}');
      final response = await http.get(url).timeout(Config.apiTimeout);
      if (response.statusCode == 200) {
        return _parseOrderLookupBody(response.body);
      }
      return null;
    } catch (e) {
      print('Error getting order by quote number: $e');
      return null;
    }
  }

  static Future<Map<String, dynamic>> updateOrder(int orderId, CustomerOrder order) async {
    try {
      print('DEBUG API: updateOrder called for orderId: $orderId');
      final url = Uri.parse('${Config.apiBaseUrl}/api/orders/$orderId');
      print('DEBUG API: URL: $url');
      
      final response = await http.put(
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode(order.toJson()),
      ).timeout(Config.apiTimeout);
      
      print('DEBUG API: Update response status: ${response.statusCode}');

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        throw Exception('Failed to update order: \${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Network error: \$e');
    }
  }

  /// Builds a real quote on marketplace.orepac.com covering every item in
  /// [items] (all on one shared quote). Takes 1-2 minutes per item (real
  /// browser automation) -- the caller should show a waiting state for the
  /// duration of this call. Emailing the result is best-effort
  /// server-side; [email] is optional.
  static Future<Map<String, dynamic>> requestOrepacQuote({
    required String customerName,
    required String phone,
    String? email,
    int? orderId,
    required List<LineItem> items,
  }) async {
    final url = Uri.parse('${Config.apiBaseUrl}/api/orepac/request-quote');
    final response = await http
        .post(
          url,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'customer_name': customerName,
            'phone': phone,
            if (email != null && email.isNotEmpty) 'email': email,
            if (orderId != null) 'order_id': orderId,
            'items': items.map((item) => item.toJson()).toList(),
          }),
        )
        .timeout(Config.orepacQuoteTimeoutFor(items.length));

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode != 200) {
      throw Exception(data['detail'] ?? 'Quote request failed (${response.statusCode})');
    }
    return data;
  }
}
