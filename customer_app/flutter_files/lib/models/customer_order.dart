import 'line_item.dart';

class CustomerOrder {
  final String customerName;
  final String phone;
  final String? email;
  final String? project;
  final List<LineItem> items;
  final String? notes;
  final List<String> photos; // Base64 encoded images

  // Milgard-specific fields
  final String? series;
  final String? operationStyle;
  final String? exteriorFinish;
  final String? interiorFinish;

  CustomerOrder({
    required this.customerName,
    required this.phone,
    this.email,
    this.project,
    required this.items,
    this.notes,
    this.photos = const [],
    this.series,
    this.operationStyle,
    this.exteriorFinish,
    this.interiorFinish,
  });

  Map<String, dynamic> toJson() {
    return {
      'customer_name': customerName,
      'phone': phone,
      if (email != null) 'email': email,
      if (project != null) 'project': project,
      'items': items.map((item) => item.toJson()).toList(),
      if (notes != null) 'notes': notes,
      'photos': photos,
      if (series != null) 'series': series,
      if (operationStyle != null) 'operation_style': operationStyle,
      if (exteriorFinish != null) 'exterior_finish': exteriorFinish,
      if (interiorFinish != null) 'interior_finish': interiorFinish,
    };
  }

  factory CustomerOrder.fromJson(Map<String, dynamic> json) {
    return CustomerOrder(
      customerName: json['customer_name'] as String,
      phone: json['phone'] as String,
      email: json['email'] as String?,
      project: json['project'] as String?,
      items: (json['items'] as List)
          .map((item) => LineItem.fromJson(item as Map<String, dynamic>))
          .toList(),
      notes: json['notes'] as String?,
      photos: (json['photos'] as List?)?.cast<String>() ?? [],
      series: json['series'] as String?,
      operationStyle: json['operation_style'] as String?,
      exteriorFinish: json['exterior_finish'] as String?,
      interiorFinish: json['interior_finish'] as String?,
    );
  }

  bool get isValid {
    return customerName.isNotEmpty && phone.isNotEmpty && items.isNotEmpty;
  }
}
