class LineItem {
  final String product;
  final int quantity;
  final String? size;
  final String? roughOpening;
  // Door-only. Field names below match the tracker's own line-item field
  // names 1:1 (as of 2026-08-11) so a value never has to be chased through
  // two different names between the app and the tracker -- see
  // blueprints/customer_intake.py's module docstring for the one
  // intentional exception (material).
  //
  // Which Or-Pac Marketplace wizard branch to submit this item under.
  // "Exterior" or "Interior" -- tracker's Door Location field.
  final String? doorLocation;
  // "Slab" or "Prehung" -- tracker's Style field.
  final String? doorStyle;
  // Exterior-only: 'Wood', 'Fiberglass', or 'Steel' -- OrePac's Product
  // Line choice (Wood) plus its own "Material" sub-question (Fiberglass/
  // Steel), collapsed into one customer-facing choice since asking
  // Fiberglass-vs-Wood and then Fiberglass-vs-Steel separately was
  // confusing (Tim 2026-08-14). Interior doors are always wood in OrePac's
  // catalog. Intentionally not tracker-field-named: the tracker only has
  // one slot (material) for the resolved value below, not this
  // intermediate choice.
  final String? doorMaterial;
  // OrePac's own "Material" question (Fiberglass/Steel) -- always the same
  // value as doorMaterial when doorMaterial is 'Fiberglass' or 'Steel'
  // (there's no longer a separate question for it). Kept as its own field
  // since it's a distinct wizard question on OrePac's side and resolves
  // into the tracker's material field alongside doorMaterial.
  final String? doorSlabMaterial;
  // Fiberglass/Steel only -- OrePac's "Door Texture" question (the skin's
  // grain/finish, e.g. "Classic Craft Fir Grain", "Traditions"). Tracker's
  // Texture field.
  final String? doorTexture;
  // '1 Panel' or '2 Panel' -- maps to OrePac wood-door Model Number 20 / 82.
  // Applies whenever the door is wood (Interior, or Exterior + doorMaterial
  // == 'Wood'). Tracker's Panel Style field.
  final String? panelStyle;
  final String? jambSize;
  final String? swing;
  final String? hingeSize;
  final String? hingeFinish;
  final String? exteriorTrim;
  final String? boring;
  final String? sill;
  // 'Primed', 'Unfinished', or 'Prefinished' -- tracker's Finish Type field.
  final String? finishType;
  // Wood species (finishType == 'Unfinished', wood doors) or stain color
  // (finishType == 'Prefinished', fiberglass doors) -- tracker's Wood
  // Species / Stain Color field.
  final String? finishDetail;
  // Door-only glass tint (Clear/Obscure/Low-E/Tempered) -- tracker's Glass
  // Tint field. Distinct from the shared `glass` field below, which is
  // lite count and means something different on a door vs. a window.
  final String? glassTint;
  // Fiberglass/Steel exterior doors with glass only -- OrePac's real
  // "Glass Shape" catalog (e.g. "Full Lite Rectangle", "Craftsman
  // Rectangle") -- tracker's Glass Shape field.
  final String? glassShape;
  // How many lites / what grid pattern within the chosen shape (e.g. "10
  // Lite", "6 Lite Colonial") -- matched against whatever OrePac's own
  // "Glass Name" options actually are for that shape at quote time, since
  // the exact option list varies per shape. Tracker's Lite Style field.
  final String? glassLiteStyle;
  // OrePac's "Frame Profile" question (Scrolled Lite Frame / Flat Lite
  // Frame) -- tracker's Lite Frame field.
  final String? frameProfile;
  final String? hardwareOption;
  final bool? qlon;
  final String? specialConditions;

  // Window-specific fields
  final String? windowType;
  final String? openingType;
  final String? width;
  final String? height;
  final String? frameMaterial;
  // Window-only exterior/frame color (White/Bronze/Black/Almond) -- doors
  // use finishType instead, a different concept (Primed/Unfinished/
  // Prefinished).
  final String? color;
  // Lite count (window) -- tracker's shared Glass/Lites field.
  final String? glass;
  final String? gridPattern;
  final bool? screen;

  // Milgard-specific fields (for windows only)
  final bool? isMilgard;
  final String? milgardSeries;
  final String? milgardOperationStyle;
  final String? milgardExteriorFinish;
  final String? milgardInteriorFinish;

  LineItem({
    required this.product,
    this.quantity = 1,
    this.size,
    this.roughOpening,
    this.doorLocation,
    this.doorStyle,
    this.doorMaterial,
    this.doorSlabMaterial,
    this.doorTexture,
    this.panelStyle,
    this.jambSize,
    this.swing,
    this.hingeSize,
    this.hingeFinish,
    this.exteriorTrim,
    this.boring,
    this.sill,
    this.finishType,
    this.finishDetail,
    this.glassTint,
    this.glassShape,
    this.glassLiteStyle,
    this.frameProfile,
    this.hardwareOption,
    this.qlon,
    this.specialConditions,
    this.windowType,
    this.openingType,
    this.width,
    this.height,
    this.frameMaterial,
    this.color,
    this.glass,
    this.gridPattern,
    this.screen,
    this.isMilgard,
    this.milgardSeries,
    this.milgardOperationStyle,
    this.milgardExteriorFinish,
    this.milgardInteriorFinish,
  });

  Map<String, dynamic> toJson() {
    return {
      'product': product,
      'quantity': quantity,
      if (size != null) 'size': size,
      if (roughOpening != null) 'rough_opening': roughOpening,
      if (doorLocation != null) 'door_location': doorLocation,
      if (doorStyle != null) 'style': doorStyle,
      if (doorMaterial != null) 'door_material': doorMaterial,
      if (doorSlabMaterial != null) 'door_slab_material': doorSlabMaterial,
      if (doorTexture != null) 'door_texture': doorTexture,
      if (panelStyle != null) 'panel_style': panelStyle,
      if (jambSize != null) 'jamb_size': jambSize,
      if (swing != null) 'swing': swing,
      if (hingeSize != null) 'hinge_size': hingeSize,
      if (hingeFinish != null) 'hinge_finish': hingeFinish,
      if (exteriorTrim != null) 'exterior_trim': exteriorTrim,
      if (boring != null) 'boring': boring,
      if (sill != null) 'sill': sill,
      if (finishType != null) 'finish_type': finishType,
      if (finishDetail != null) 'finish_detail': finishDetail,
      if (glassTint != null) 'glass_tint': glassTint,
      if (glassShape != null) 'door_glass_shape': glassShape,
      if (glassLiteStyle != null) 'door_glass_lite_style': glassLiteStyle,
      if (frameProfile != null) 'door_frame_profile': frameProfile,
      if (hardwareOption != null) 'hardware_option': hardwareOption,
      if (qlon != null) 'qlon': qlon,
      if (specialConditions != null) 'special_conditions': specialConditions,
      if (windowType != null) 'window_type': windowType,
      if (openingType != null) 'opening_type': openingType,
      if (width != null) 'width': width,
      if (height != null) 'height': height,
      if (frameMaterial != null) 'frame_material': frameMaterial,
      if (color != null) 'color': color,
      if (glass != null) 'glass': glass,
      if (gridPattern != null) 'grid_pattern': gridPattern,
      if (screen != null) 'screen': screen,
      if (isMilgard != null) 'is_milgard': isMilgard,
      if (milgardSeries != null) 'milgard_series': milgardSeries,
      if (milgardOperationStyle != null)
        'milgard_operation_style': milgardOperationStyle,
      if (milgardExteriorFinish != null)
        'milgard_exterior_finish': milgardExteriorFinish,
      if (milgardInteriorFinish != null)
        'milgard_interior_finish': milgardInteriorFinish,
    };
  }

  factory LineItem.fromJson(Map<String, dynamic> json) {
    return LineItem(
      product: json['product'] as String,
      quantity: json['quantity'] as int? ?? 1,
      size: json['size'] as String?,
      roughOpening: json['rough_opening'] as String?,
      doorLocation: json['door_location'] as String?,
      doorStyle: json['style'] as String?,
      doorMaterial: json['door_material'] as String?,
      doorSlabMaterial: json['door_slab_material'] as String?,
      doorTexture: json['door_texture'] as String?,
      panelStyle: json['panel_style'] as String?,
      jambSize: json['jamb_size'] as String?,
      swing: json['swing'] as String?,
      hingeSize: json['hinge_size'] as String?,
      hingeFinish: json['hinge_finish'] as String?,
      exteriorTrim: json['exterior_trim'] as String?,
      boring: json['boring'] as String?,
      sill: json['sill'] as String?,
      finishType: json['finish_type'] as String?,
      finishDetail: json['finish_detail'] as String?,
      glassTint: json['glass_tint'] as String?,
      glassShape: json['door_glass_shape'] as String?,
      glassLiteStyle: json['door_glass_lite_style'] as String?,
      frameProfile: json['door_frame_profile'] as String?,
      hardwareOption: json['hardware_option'] as String?,
      qlon: json['qlon'] as bool?,
      specialConditions: json['special_conditions'] as String?,
      windowType: json['window_type'] as String?,
      openingType: json['opening_type'] as String?,
      width: json['width'] as String?,
      height: json['height'] as String?,
      frameMaterial: json['frame_material'] as String?,
      color: json['color'] as String?,
      glass: json['glass'] as String?,
      gridPattern: json['grid_pattern'] as String?,
      screen: json['screen'] as bool?,
      isMilgard: json['is_milgard'] as bool?,
      milgardSeries: json['milgard_series'] as String?,
      milgardOperationStyle: json['milgard_operation_style'] as String?,
      milgardExteriorFinish: json['milgard_exterior_finish'] as String?,
      milgardInteriorFinish: json['milgard_interior_finish'] as String?,
    );
  }

  String get displayName {
    if (product == 'Door') {
      final parts = [
        if (quantity > 1) '(${quantity}x)',
        product,
        if (size != null) size,
        if (jambSize != null) jambSize,
        if (swing != null) swing,
      ];
      return parts.where((p) => p != null).join(' — ');
    } else if (product == 'Window') {
      final sizeStr =
          (width != null && height != null) ? '$width x $height' : '';
      final parts = [
        if (quantity > 1) '(${quantity}x)',
        product,
        if (windowType != null) windowType,
        if (sizeStr.isNotEmpty) sizeStr,
      ];
      return parts.where((p) => p != null).join(' — ');
    }
    return '$product${quantity > 1 ? " (${quantity}x)" : ""}';
  }
}
