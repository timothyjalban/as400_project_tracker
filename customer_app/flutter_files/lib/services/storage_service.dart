import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/customer_order.dart';
import 'api_service.dart';

class StorageService {
  SharedPreferences? _prefs;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  Future<void> saveDraft(CustomerOrder order) async {
    // Try to save to server first (cross-device)
    if (order.phone.isNotEmpty) {
      try {
        await ApiService.saveDraft(order);
        // Clear local draft since we saved to server
        await _prefs?.remove('draft_order');
        return;
      } catch (e) {
        print('Failed to save draft to server, falling back to local storage: $e');
      }
    }
    
    // Fallback to local storage
    final json = jsonEncode(order.toJson());
    await _prefs?.setString('draft_order', json);
  }

  Future<CustomerOrder?> loadDraft() async {
    // First check local storage
    final json = _prefs?.getString('draft_order');
    if (json != null) {
      try {
        return CustomerOrder.fromJson(jsonDecode(json) as Map<String, dynamic>);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  Future<CustomerOrder?> loadDraftByPhone(String phone) async {
    // Load draft from server by phone number
    if (phone.isEmpty) return null;
    
    try {
      return await ApiService.loadDraft(phone);
    } catch (e) {
      print('Failed to load draft from server: $e');
      return null;
    }
  }

  Future<void> clearDraft() async {
    await _prefs?.remove('draft_order');
  }

  Future<void> clearDraftByPhone(String phone) async {
    if (phone.isNotEmpty) {
      try {
        await ApiService.deleteDraft(phone);
      } catch (e) {
        print('Failed to delete draft from server: $e');
      }
    }
    await clearDraft();
  }

  Future<void> saveLastCustomerInfo({
    required String name,
    required String phone,
    String? email,
  }) async {
    await _prefs?.setString('last_customer_name', name);
    await _prefs?.setString('last_customer_phone', phone);
    if (email != null) {
      await _prefs?.setString('last_customer_email', email);
    }
  }

  Map<String, String?> getLastCustomerInfo() {
    return {
      'name': _prefs?.getString('last_customer_name'),
      'phone': _prefs?.getString('last_customer_phone'),
      'email': _prefs?.getString('last_customer_email'),
    };
  }
}
