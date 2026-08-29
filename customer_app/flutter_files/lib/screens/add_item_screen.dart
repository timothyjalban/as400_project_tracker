import 'dart:convert';

import 'package:flutter/material.dart';
import '../models/line_item.dart';

/// One page of the add-item wizard. [isApplicable] lets a step skip itself
/// (e.g. "Slab Material" only applies to an Exterior Fiberglass door)
/// without changing the list's length/order -- _advance/_goBack just walk
/// past steps that report themselves not applicable.
class _WizardStep {
  final bool Function()? isApplicable;
  final Widget Function() build;

  const _WizardStep({required this.build, this.isApplicable});

  bool get applicable => isApplicable?.call() ?? true;
}

class AddItemScreen extends StatefulWidget {
  final LineItem? item;
  final String? initialProduct;

  const AddItemScreen({super.key, this.item, this.initialProduct});

  @override
  State<AddItemScreen> createState() => _AddItemScreenState();
}

class _AddItemScreenState extends State<AddItemScreen> {
  int _stepIndex = 0;

  // Opening type options, shared between doors and windows. Rough Opening
  // and Net Frame both mean "use the entered/derived measurement as-is";
  // Finished Opening triggers the +2"/+2.25" (door) or +0.5" (window)
  // rough-opening calculation - matching the formulas already used by the
  // desktop order tracker (order_tracker.py) for Call Out/Net Frame sizing.
  static const List<String> openingTypeOptions = [
    'Rough Opening',
    'Finished Opening',
    'Net Frame',
  ];

  // Common fields
  String? _productType;
  int _quantity = 1;

  // Door fields
  // Or-Pac Marketplace wizard branch -- determines which product line and
  // downstream questions apply, so these are required, not just cosmetic.
  static const List<String> doorLocationOptions = ['Exterior', 'Interior'];
  // Values match the tracker's own Style field exactly ('Slab'/'Prehung'),
  // not Or-Pac's longer wizard wording.
  static const List<String> doorStyleOptions = ['Slab', 'Prehung'];
  // Which OrePac wood-door Model Number to order -- see
  // PANEL_STYLE_TO_MODEL_NUMBER_INTERIOR/_EXTERIOR in
  // scripts/orepac_submit_quote.py for the actual mapping. Interior list
  // confirmed 2026-08-13 by downloading and visually inspecting every
  // option's real catalog image; Exterior stays limited to 1/2 Panel
  // until the Builders Choice/Rogue Valley catalogs get the same
  // treatment.
  static const List<String> doorPanelStyleOptionsInterior = [
    '1 Panel',
    '2 Panel',
    '3 Panel',
    '4 Panel',
    '5 Panel',
    '6 Panel',
    '1 Lite',
    '2 Lite',
    '3 Lite',
    '5 Lite',
    '10 Lite',
    '15 Lite',
    'Louver',
    'Plank',
  ];
  // Confirmed 2026-08-14 against OrePac's real Exterior wood catalogs
  // (Builders Choice + Rogue Valley Door Special Order) -- 15 Lite isn't
  // offered in either Exterior catalog, unlike Interior, so it's left out
  // here on purpose.
  static const List<String> doorPanelStyleOptionsExterior = [
    '1 Panel',
    '2 Panel',
    '3 Panel',
    '4 Panel',
    '5 Panel',
    '6 Panel',
    '1 Lite',
    '2 Lite',
    '3 Lite',
    '5 Lite',
    '10 Lite',
    'Louver',
    'Plank',
  ];
  // Finish Type top-level choice mirrors OrePac's actual branching: wood
  // doors (Interior) ask Primed vs. a real wood species; fiberglass doors
  // (Exterior) ask Unfinished vs. a factory Prefinished color - confirmed
  // against the real wizard by Tim 2026-08-07.
  static const List<String> finishTypeOptionsWood = ['Primed', 'Unfinished'];
  static const List<String> finishTypeOptionsFiberglass = [
    'Unfinished',
    'Prefinished',
  ];
  // OrePac's real "Wood Species" answer list (minus "Primed", which is
  // handled by the top-level Finish Type choice above instead).
  static const List<String> woodSpeciesOptions = [
    'Fir',
    'Cherry',
    'Knotty Alder',
    'Knotty Pine',
    'Maple',
    'Birch',
    'Hemlock',
    'Hickory',
    'Alder',
    'Ash',
    'Jatoba',
    'Knotty Hickory',
    'Mahogany',
    'Pine',
    'Poplar',
    '1/4 Sawn Red Oak',
    '1/4 Sawn White Oak',
    'Red Oak',
    'Rift Cut Red Oak',
    'Rift Cut White Oak',
    'Rustic Cherry',
    'Rustic Red Oak',
    'Rustic Walnut',
    'SDF',
    'Walnut',
    'Western Red Cedar',
    'White Oak',
    'Yellow Cypress',
  ];
  // OrePac's real "Stain Door" color list, offered when a fiberglass door
  // is Prefinished.
  static const List<String> doorStainColorOptions = [
    'Tumbleweed',
    'Acorn',
    'Wildflower Honey',
    'Rustic Clay',
    'Barley',
    'Mulberry',
    'Autumn Harvest',
    'New Earth',
    'Driftwood',
    'Raven',
  ];
  // Exterior-only: OrePac offers Wood, Fiberglass, or Steel exterior doors
  // (the Therma-Tru line covers both Fiberglass and Steel; Wood is the
  // separate Stile and Rail line) - Interior doors don't offer Fiberglass
  // or Steel in OrePac's catalog at all, so interior stays wood-only (no
  // picker shown for it). Fiberglass and Steel used to be a separate
  // follow-up question ("Slab Material") after picking Fiberglass here,
  // which just asked Fiberglass-vs-Steel again -- confirmed confusing by
  // Tim 2026-08-14, collapsed into one choice; doorSlabMaterial (OrePac's
  // own question of the same name) is set directly from this pick now.
  static const List<String> doorMaterialOptions = ['Wood', 'Fiberglass', 'Steel'];
  // OrePac's real "Door Texture" answers for the Therma-Tru line -- differ
  // by Fiberglass vs. Steel slab. Confirmed 2026-08-14 by walking the real
  // wizard's "No Style Number" path (Claude, via Selenium).
  static const List<String> doorTextureOptionsFiberglass = [
    'Smooth-Star',
    'Classic Craft Fir Grain',
    'Classic Craft Mahogany Grain',
    'Classic Craft Canvas',
    'Fiber-Classic Oak Collection',
    'Fiber-Classic Mahogany Collection',
  ];
  static const List<String> doorTextureOptionsSteel = ['Traditions', 'Profiles'];

  // OrePac's real "Glass Shape" catalog for a Fiberglass/Steel door with
  // glass -- confirmed 2026-08-14 the same way as Door Texture. Real
  // images downloaded from OrePac's own CDN into assets/glass_shapes/ (the
  // same approach as the swing-direction images -- avoids the CORS/loading
  // trouble a remote Image.network hit before). (name, asset) pairs.
  static const List<(String, String)> glassShapeOptions = [
    ('Full Lite Rectangle', 'assets/glass_shapes/full_lite_rectangle.png'),
    ('Craftsman Rectangle', 'assets/glass_shapes/craftsman_rectangle.png'),
    ('3/4 Rectangle', 'assets/glass_shapes/3_4_rectangle.png'),
    ('3/4 Oval', 'assets/glass_shapes/3_4_oval.png'),
    ('Half Lite Rectangle', 'assets/glass_shapes/half_lite_rectangle.png'),
    (
      'Half Lite 1 Panel Top and Bottom',
      'assets/glass_shapes/half_lite_1_panel_top_and_bottom.png',
    ),
    ('Twin Lites', 'assets/glass_shapes/twin_lites.png'),
    ('1/3 Rectangle', 'assets/glass_shapes/1_3_rectangle.png'),
    ('Camber Top Lite', 'assets/glass_shapes/camber_top_lite.png'),
    ('Top Lite', 'assets/glass_shapes/top_lite.png'),
    ('Fanlite', 'assets/glass_shapes/fanlite.png'),
    ('Twin Top Lites', 'assets/glass_shapes/twin_top_lites.png'),
    ('Center Lite Rectangle', 'assets/glass_shapes/center_lite_rectangle.png'),
    ('Ari 3-Lite', 'assets/glass_shapes/ari_3_lite.png'),
    ('Linea Left', 'assets/glass_shapes/linea_left.png'),
    ('Linea Centered', 'assets/glass_shapes/linea_centered.png'),
    ('Linea Right', 'assets/glass_shapes/linea_right.png'),
    ('Echo 4-Lite Left', 'assets/glass_shapes/echo_4_lite_left.png'),
    ('Echo 4-Lite Centered', 'assets/glass_shapes/echo_4_lite_centered.png'),
    ('Echo 4-Lite Right', 'assets/glass_shapes/echo_4_lite_right.png'),
    ('Echo 5-Lite Left', 'assets/glass_shapes/echo_5_lite_left.png'),
    ('Echo 5-Lite Centered', 'assets/glass_shapes/echo_5_lite_centered.png'),
    ('Echo 5-Lite Right', 'assets/glass_shapes/echo_5_lite_right.png'),
    (
      'Echo 3-Lite Middle Left Cluster',
      'assets/glass_shapes/echo_3_lite_middle_left_cluster.png',
    ),
    (
      'Echo 3-Lite Middle Center Cluster',
      'assets/glass_shapes/echo_3_lite_middle_center_cluster.png',
    ),
    (
      'Echo 3-Lite Middle Right Cluster',
      'assets/glass_shapes/echo_3_lite_middle_right_cluster.png',
    ),
    (
      'Echo 3-Lite Top Left Cluster',
      'assets/glass_shapes/echo_3_lite_top_left_cluster.png',
    ),
    (
      'Echo 3-Lite Top Center Cluster',
      'assets/glass_shapes/echo_3_lite_top_center_cluster.png',
    ),
    (
      'Echo 3-Lite Top Right Cluster',
      'assets/glass_shapes/echo_3_lite_top_right_cluster.png',
    ),
  ];
  // Curated -- OrePac's real "Glass Name" (lite count/grid pattern) list
  // varies per Glass Shape, so the automation matches this against
  // whatever that shape's real options actually are at quote time rather
  // than a shape-by-shape catalog. 'Clear Lite' means a plain single pane,
  // no grid.
  static const List<String> glassLiteStyleOptions = [
    'Clear Lite (no grid)',
    '4 Lite Colonial',
    '6 Lite Colonial',
    '8 Lite Colonial',
    '9 Lite Prairie',
    '10 Lite',
    '12 Lite',
    '15 Lite',
  ];
  static const List<String> frameProfileOptions = [
    'Flat Lite Frame',
    'Scrolled Lite Frame',
  ];

  // Nothing pre-selected -- the customer has to actively choose every
  // field, per Tim 2026-08-11 ("remove the default selections").
  String? _doorLocation;
  String? _doorStyle;
  String? _doorMaterial;
  String? _doorSlabMaterial;
  String? _doorTexture;
  String? _panelStyle;
  String? _doorSize;
  String? _doorOpeningType;
  final _roughOpeningController = TextEditingController();
  String? _jambSize;
  final _customJambSizeController = TextEditingController();
  String? _swing;
  String? _hingeSize;
  String? _hingeFinish;
  String? _exteriorTrim;
  String? _boring;
  String? _sill;
  bool? _qlon;
  String? _finishType;
  // Wood species (when _finishType == 'Unfinished' and the door is wood) or
  // stain color (when _finishType == 'Prefinished' and the door is
  // fiberglass).
  String? _finishDetail;
  String? _glassTint;
  String? _glassShape;
  String? _glassLiteStyle;
  String? _frameProfile;
  bool? _includeHardware;
  String? _hardwareOption;
  final _doorSpecialController = TextEditingController();

  // True for Interior doors (always wood in OrePac's catalog) and for
  // Exterior doors where Wood was picked as the material.
  bool get _isWoodDoor =>
      _doorLocation == 'Interior' || (_doorLocation == 'Exterior' && _doorMaterial == 'Wood');

  // Window fields
  String? _windowType;
  String? _openingType;
  String? _windowSize;
  final _widthController = TextEditingController();
  final _heightController = TextEditingController();
  final _windowRoController = TextEditingController();
  String? _frameMaterial;
  String? _windowColor;
  String? _windowGlass;
  String? _gridPattern;
  bool? _screen;
  final _windowSpecialController = TextEditingController();

  // Milgard fields
  bool? _isMilgard;
  String? _milgardSeries;
  String? _milgardOperationStyle;
  final _milgardExteriorFinishController = TextEditingController();
  final _milgardInteriorFinishController = TextEditingController();

  @override
  void initState() {
    super.initState();

    if (widget.item != null) {
      _loadItemData();
      _stepIndex = 1;
    } else if (widget.initialProduct != null) {
      _productType = widget.initialProduct;
      _stepIndex = 1;
    }
  }

  void _loadItemData() {
    final item = widget.item!;
    _quantity = item.quantity;
    _productType = item.product;

    if (item.product == 'Door') {
      _doorLocation = item.doorLocation;
      _doorStyle = item.doorStyle;
      _doorMaterial = item.doorMaterial;
      _doorSlabMaterial = item.doorSlabMaterial;
      _doorTexture = item.doorTexture;
      _panelStyle = item.panelStyle;
      _doorSize = item.size;
      _doorOpeningType = item.openingType;
      _roughOpeningController.text = item.roughOpening ?? '';
      _jambSize = item.jambSize;
      if (_jambSize != null &&
          !_getJambSizes().any((e) => e.value == _jambSize)) {
        _customJambSizeController.text = _jambSize!;
      }
      _swing = item.swing;
      _hingeSize = item.hingeSize;
      _hingeFinish = item.hingeFinish;
      _exteriorTrim = item.exteriorTrim;
      _boring = item.boring;
      _sill = item.sill;
      _qlon = item.qlon;
      _finishType = item.finishType;
      _finishDetail = item.finishDetail;
      _glassTint = item.glassTint;
      _glassShape = item.glassShape;
      _glassLiteStyle = item.glassLiteStyle;
      _frameProfile = item.frameProfile;
      _hardwareOption = item.hardwareOption;
      _includeHardware = item.hardwareOption != null ? true : null;
      _doorSpecialController.text = item.specialConditions ?? '';
    } else {
      _windowType = item.windowType;
      _openingType = item.openingType;
      _widthController.text = item.width ?? '';
      _heightController.text = item.height ?? '';
      _windowRoController.text = item.roughOpening ?? '';
      _frameMaterial = item.frameMaterial;
      _windowColor = item.color;
      _windowGlass = item.glass;
      _gridPattern = item.gridPattern;
      _screen = item.screen;
      _windowSpecialController.text = item.specialConditions ?? '';
      _isMilgard = item.isMilgard;
      _milgardSeries = item.milgardSeries;
      _milgardOperationStyle = item.milgardOperationStyle;
      _milgardExteriorFinishController.text = item.milgardExteriorFinish ?? '';
      _milgardInteriorFinishController.text = item.milgardInteriorFinish ?? '';
    }
  }

  @override
  void dispose() {
    _roughOpeningController.dispose();
    _customJambSizeController.dispose();
    _doorSpecialController.dispose();
    _widthController.dispose();
    _heightController.dispose();
    _windowRoController.dispose();
    _windowSpecialController.dispose();
    _milgardExteriorFinishController.dispose();
    _milgardInteriorFinishController.dispose();
    super.dispose();
  }

  void _saveItem() {
    final isDoor = _productType == 'Door';

    final item = LineItem(
      product: isDoor ? 'Door' : 'Window',
      quantity: _quantity,
      size: isDoor ? _doorSize : null,
      doorLocation: isDoor ? _doorLocation : null,
      doorStyle: isDoor ? _doorStyle : null,
      doorMaterial: isDoor && _doorLocation == 'Exterior' ? _doorMaterial : null,
      doorSlabMaterial:
          isDoor &&
                  _doorLocation == 'Exterior' &&
                  (_doorMaterial == 'Fiberglass' || _doorMaterial == 'Steel')
              ? _doorSlabMaterial
              : null,
      doorTexture:
          isDoor &&
                  _doorLocation == 'Exterior' &&
                  (_doorMaterial == 'Fiberglass' || _doorMaterial == 'Steel')
              ? _doorTexture
              : null,
      panelStyle: isDoor && _isWoodDoor ? _panelStyle : null,
      roughOpening:
          isDoor ? _roughOpeningController.text : _windowRoController.text,
      jambSize: isDoor ? _jambSize : null,
      swing: isDoor ? _swing : null,
      hingeSize: isDoor ? _hingeSize : null,
      hingeFinish: isDoor ? _hingeFinish : null,
      exteriorTrim: isDoor ? _exteriorTrim : null,
      boring: isDoor ? _boring : null,
      sill: isDoor ? _sill : null,
      color: !isDoor ? _windowColor : null,
      finishType: isDoor ? _finishType : null,
      finishDetail: isDoor ? _finishDetail : null,
      glassTint: isDoor ? _glassTint : null,
      glassShape: isDoor ? _glassShape : null,
      glassLiteStyle: isDoor ? _glassLiteStyle : null,
      frameProfile: isDoor ? _frameProfile : null,
      glass: !isDoor ? _windowGlass : null,
      hardwareOption: isDoor ? _hardwareOption : null,
      qlon: isDoor ? _qlon : null,
      specialConditions:
          isDoor ? _doorSpecialController.text : _windowSpecialController.text,
      windowType: !isDoor ? _windowType : null,
      openingType: isDoor ? _doorOpeningType : _openingType,
      width: !isDoor ? _widthController.text : null,
      height: !isDoor ? _heightController.text : null,
      frameMaterial: !isDoor ? _frameMaterial : null,
      gridPattern: !isDoor ? _gridPattern : null,
      screen: !isDoor ? _screen : null,
      isMilgard: !isDoor ? _isMilgard : null,
      milgardSeries: !isDoor && _isMilgard == true ? _milgardSeries : null,
      milgardOperationStyle:
          !isDoor && _isMilgard == true ? _milgardOperationStyle : null,
      milgardExteriorFinish: !isDoor &&
              _isMilgard == true &&
              _milgardExteriorFinishController.text.isNotEmpty
          ? _milgardExteriorFinishController.text
          : null,
      milgardInteriorFinish: !isDoor &&
              _isMilgard == true &&
              _milgardInteriorFinishController.text.isNotEmpty
          ? _milgardInteriorFinishController.text
          : null,
    );

    // Temporary: print the saved item's JSON so it can be copied into a
    // file for testing scripts/orepac_download_quote.py against real
    // Flutter-produced data. Safe to remove once that's no longer needed.
    print('LineItem JSON: ${jsonEncode(item.toJson())}');

    Navigator.pop(context, item);
  }

  // ── Wizard plumbing ───────────────────────────────────────────────────

  List<_WizardStep> get _steps {
    final steps = <_WizardStep>[_productTypeStep()];
    if (_productType == 'Door') {
      steps.addAll(_doorSteps());
    } else if (_productType == 'Window') {
      steps.addAll(_windowSteps());
    }
    return steps;
  }

  void _advance() {
    final steps = _steps;
    var next = _stepIndex + 1;
    while (next < steps.length && !steps[next].applicable) {
      next++;
    }
    setState(() => _stepIndex = next.clamp(0, steps.length - 1));
  }

  void _goBack() {
    final steps = _steps;
    var prev = _stepIndex - 1;
    while (prev >= 0 && !steps[prev].applicable) {
      prev--;
    }
    if (prev < 0) {
      Navigator.pop(context);
      return;
    }
    setState(() => _stepIndex = prev);
  }

  @override
  Widget build(BuildContext context) {
    final steps = _steps;
    final index = _stepIndex.clamp(0, steps.length - 1);
    final applicableIndices = [
      for (var i = 0; i < steps.length; i++) if (steps[i].applicable) i,
    ];
    final position = applicableIndices.indexOf(index) + 1;
    final total = applicableIndices.length;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Text(widget.item == null ? 'Add Item' : 'Edit Item'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (total > 1)
              LinearProgressIndicator(value: position / total),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
              child: Row(
                children: [
                  // Deliberately a full labeled button, not just the small
                  // AppBar arrow icon, so it's obvious the customer can
                  // step back and change an earlier answer -- per Tim
                  // 2026-08-12.
                  TextButton.icon(
                    onPressed: _goBack,
                    icon: const Icon(Icons.arrow_back),
                    label: const Text('Back'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                child: steps[index].build(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Shared step chrome ─────────────────────────────────────────────────

  Widget _stepScaffold({
    required String title,
    required Widget content,
    bool showContinue = false,
    VoidCallback? onContinue,
    String? continueLabel,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 20),
        content,
        if (showContinue) ...[
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: onContinue ?? _advance,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: Text(continueLabel ?? 'Continue'),
            ),
          ),
        ],
      ],
    );
  }

  Widget _choiceGrid({
    required List<String> options,
    required String? selected,
    required ValueChanged<String> onSelect,
  }) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: options.map((option) {
        final isSelected = selected == option;
        return ChoiceChip(
          label: Text(option, style: const TextStyle(fontSize: 15)),
          selected: isSelected,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          onSelected: (_) => onSelect(option),
        );
      }).toList(),
    );
  }

  Widget _yesNoGrid({
    required bool? selected,
    required ValueChanged<bool> onSelect,
  }) {
    return Wrap(
      spacing: 10,
      children: [
        ChoiceChip(
          label: const Text('Yes'),
          selected: selected == true,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
          onSelected: (_) => onSelect(true),
        ),
        ChoiceChip(
          label: const Text('No'),
          selected: selected == false,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
          onSelected: (_) => onSelect(false),
        ),
      ],
    );
  }

  /// A choice-button step: tapping any option both records it and advances
  /// to the next page. [required] steps show no Skip/Continue button, so
  /// the only way forward is to actually pick one.
  _WizardStep _choiceStep({
    required String title,
    required List<String> Function() options,
    required String? Function() getValue,
    required void Function(String value) onSelect,
    bool required = false,
    bool Function()? isApplicable,
  }) {
    return _WizardStep(
      isApplicable: isApplicable,
      build: () => _stepScaffold(
        title: title,
        content: _choiceGrid(
          options: options(),
          selected: getValue(),
          onSelect: (value) {
            setState(() => onSelect(value));
            _advance();
          },
        ),
        showContinue: !required,
        continueLabel: getValue() == null ? 'Skip' : 'Continue',
      ),
    );
  }

  _WizardStep _yesNoStep({
    required String title,
    required bool? Function() getValue,
    required void Function(bool value) onSelect,
    bool Function()? isApplicable,
  }) {
    return _WizardStep(
      isApplicable: isApplicable,
      build: () => _stepScaffold(
        title: title,
        content: _yesNoGrid(
          selected: getValue(),
          onSelect: (value) {
            setState(() => onSelect(value));
            _advance();
          },
        ),
      ),
    );
  }

  // ── Step 0: product type ────────────────────────────────────────────────

  _WizardStep _productTypeStep() {
    return _WizardStep(
      build: () => _stepScaffold(
        title: 'Door or Window?',
        content: _choiceGrid(
          options: const ['Door', 'Window'],
          selected: _productType,
          onSelect: (value) {
            setState(() => _productType = value);
            _advance();
          },
        ),
      ),
    );
  }

  // ── Door step sequence ──────────────────────────────────────────────────

  List<_WizardStep> _doorSteps() {
    return [
      _choiceStep(
        title: 'Door Location',
        options: () => doorLocationOptions,
        getValue: () => _doorLocation,
        required: true,
        onSelect: (value) {
          _doorLocation = value;
          // Downstream fields depend on Location -- clear rather than
          // pre-guess a value, so the customer always chooses explicitly.
          _doorMaterial = null;
          _doorSlabMaterial = null;
          _doorTexture = null;
          _finishType = null;
          _finishDetail = null;
          _panelStyle = null;
        },
      ),
      _choiceStep(
        title: 'Door Material',
        options: () => doorMaterialOptions,
        getValue: () => _doorMaterial,
        required: true,
        isApplicable: () => _doorLocation == 'Exterior',
        onSelect: (value) {
          _doorMaterial = value;
          // Fiberglass/Steel is both the top-level Material choice and
          // OrePac's own "Material" sub-question -- no separate question
          // for it anymore (Tim 2026-08-14).
          _doorSlabMaterial = value == 'Fiberglass' || value == 'Steel' ? value : null;
          _doorTexture = null;
          _finishType = null;
          _finishDetail = null;
          _panelStyle = null;
        },
      ),
      _choiceStep(
        title: 'Texture',
        options: () => _doorMaterial == 'Steel'
            ? doorTextureOptionsSteel
            : doorTextureOptionsFiberglass,
        getValue: () => _doorTexture,
        required: true,
        isApplicable: () =>
            _doorLocation == 'Exterior' &&
            (_doorMaterial == 'Fiberglass' || _doorMaterial == 'Steel'),
        onSelect: (value) => _doorTexture = value,
      ),
      _choiceStep(
        title: 'Door Style',
        options: () => doorStyleOptions,
        getValue: () => _doorStyle,
        required: true,
        onSelect: (value) => _doorStyle = value,
      ),
      _choiceStep(
        title: 'Panel Style',
        options: () => _doorLocation == 'Interior'
            ? doorPanelStyleOptionsInterior
            : doorPanelStyleOptionsExterior,
        getValue: () => _panelStyle,
        required: true,
        isApplicable: () => _isWoodDoor,
        onSelect: (value) => _panelStyle = value,
      ),
      _WizardStep(
        build: () => _stepScaffold(
          title: 'Quantity',
          content: _buildQuantityField(),
          showContinue: true,
          onContinue: _advance,
        ),
      ),
      _choiceStep(
        title: 'Opening Type',
        options: () => openingTypeOptions,
        getValue: () => _doorOpeningType,
        onSelect: (value) {
          _doorOpeningType = value;
          _calculateDoorRoughOpening();
        },
      ),
      _choiceStep(
        title: 'Door Size',
        options: () => _getDoorSizes().map((e) => e.value as String).toList(),
        getValue: () => _doorSize,
        required: true,
        onSelect: (value) {
          _doorSize = value;
          _calculateDoorRoughOpening();
        },
      ),
      _jambSizeStep(),
      _swingStep(),
      _choiceStep(
        title: 'Hinge Size',
        options: () => const ['3"', '3-1/2"', '4"', '4-1/2"'],
        getValue: () => _hingeSize,
        onSelect: (value) => _hingeSize = value,
      ),
      _choiceStep(
        title: 'Hinge Finish',
        options: () => const [
          'Satin Nickel',
          'Oil-Rubbed Bronze',
          'Bright Brass',
          'Polished Chrome',
          'Brushed Chrome',
          'Black',
        ],
        getValue: () => _hingeFinish,
        onSelect: (value) => _hingeFinish = value,
      ),
      _choiceStep(
        title: 'Exterior Trim',
        options: () => const ['Brickmould', 'No Exterior Trim'],
        getValue: () => _exteriorTrim,
        onSelect: (value) => _exteriorTrim = value,
      ),
      _choiceStep(
        title: 'Boring',
        options: () => const ['Single', 'Double', 'None'],
        getValue: () => _boring,
        onSelect: (value) => _boring = value,
      ),
      _choiceStep(
        title: 'Sill',
        options: () => const ['Bronze', 'Aluminum'],
        getValue: () => _sill,
        isApplicable: () => _doorLocation == 'Exterior',
        onSelect: (value) => _sill = value,
      ),
      _choiceStep(
        title: 'Finish Type',
        options: () =>
            _isWoodDoor ? finishTypeOptionsWood : finishTypeOptionsFiberglass,
        getValue: () => _finishType,
        onSelect: (value) {
          _finishType = value;
          _finishDetail = null;
        },
      ),
      _choiceStep(
        title: 'Wood Species',
        options: () => woodSpeciesOptions,
        getValue: () => _finishDetail,
        isApplicable: () => _isWoodDoor && _finishType == 'Unfinished',
        onSelect: (value) => _finishDetail = value,
      ),
      _choiceStep(
        title: 'Finish Color',
        options: () => doorStainColorOptions,
        getValue: () => _finishDetail,
        isApplicable: () => !_isWoodDoor && _finishType == 'Prefinished',
        onSelect: (value) => _finishDetail = value,
      ),
      _choiceStep(
        title: 'Glass Tint',
        options: () => const ['Clear', 'Obscure', 'Low-E', 'Tempered'],
        getValue: () => _glassTint,
        // Interior doors are just a 1 or 2 panel slab, no glass -- per Tim
        // 2026-08-12.
        isApplicable: () => _doorLocation == 'Exterior',
        onSelect: (value) {
          _glassTint = value;
          _glassShape = null;
          _glassLiteStyle = null;
          _frameProfile = null;
        },
      ),
      _glassShapeStep(),
      _choiceStep(
        title: 'Lite Style',
        options: () => glassLiteStyleOptions,
        getValue: () => _glassLiteStyle,
        // Wood doors pick their lite count through Panel Style (1 Lite, 2
        // Lite, ...) instead -- this is only the Fiberglass/Steel glass
        // catalog (Tim 2026-08-14: order 438 showed a Clear-glass pick
        // with no way to say how many lites, what style, or grids).
        isApplicable: () => _doorLocation == 'Exterior' && !_isWoodDoor && _glassTint != null,
        onSelect: (value) => _glassLiteStyle = value,
      ),
      _choiceStep(
        title: 'Lite Frame',
        options: () => frameProfileOptions,
        getValue: () => _frameProfile,
        isApplicable: () => _doorLocation == 'Exterior' && !_isWoodDoor && _glassTint != null,
        onSelect: (value) => _frameProfile = value,
      ),
      _yesNoStep(
        title: 'Would you like hardware included?',
        getValue: () => _includeHardware,
        onSelect: (value) {
          _includeHardware = value;
          if (value == false) _hardwareOption = null;
        },
      ),
      _choiceStep(
        title: 'Hardware',
        options: () => const ['Standard', 'Lever', 'Knob', 'Deadbolt'],
        getValue: () => _hardwareOption,
        isApplicable: () => _includeHardware == true,
        onSelect: (value) => _hardwareOption = value,
      ),
      _yesNoStep(
        title: 'Q-lon Weatherstripping?',
        getValue: () => _qlon,
        isApplicable: () => _doorLocation == 'Exterior',
        onSelect: (value) => _qlon = value,
      ),
      _WizardStep(
        build: () => _stepScaffold(
          title: 'Special Conditions',
          content: TextFormField(
            controller: _doorSpecialController,
            decoration:
                const InputDecoration(labelText: 'Special Conditions'),
            maxLines: 3,
          ),
          showContinue: true,
          onContinue: _advance,
        ),
      ),
      _reviewStep(isDoor: true),
    ];
  }

  // ── Window step sequence ────────────────────────────────────────────────

  List<_WizardStep> _windowSteps() {
    return [
      _yesNoStep(
        title: 'Is this a Milgard window?',
        getValue: () => _isMilgard,
        onSelect: (value) => _isMilgard = value,
      ),
      _choiceStep(
        title: 'Window Type',
        options: () => const [
          'Single Hung',
          'Double Hung',
          'Casement',
          'Sliding',
          'Picture',
          'Awning',
          'Bay',
          'Bow',
        ],
        getValue: () => _windowType,
        required: true,
        isApplicable: () => _isMilgard == false,
        onSelect: (value) => _windowType = value,
      ),
      _choiceStep(
        title: 'Milgard Series',
        options: () => const [
          'V400 Tuscany',
          'V300 Trinsic',
          'V250 Style Line',
          'C650 Ultra',
          'A250 Aluminum',
        ],
        getValue: () => _milgardSeries,
        isApplicable: () => _isMilgard == true,
        onSelect: (value) {
          _milgardSeries = value;
          // Frame material follows directly from the series they picked --
          // a derived consequence, not a pre-filled guess.
          if (value.contains('Tuscany') ||
              value.contains('Trinsic') ||
              value.contains('Style Line')) {
            _frameMaterial = 'Vinyl';
          } else if (value.contains('Ultra')) {
            _frameMaterial = 'Fiberglass';
          } else if (value.contains('Aluminum')) {
            _frameMaterial = 'Aluminum';
          }
        },
      ),
      _choiceStep(
        title: 'Milgard Operation Style',
        options: () => const [
          'Single Hung',
          'Double Hung',
          'Horizontal Slider',
          'Casement',
          'Picture Window',
          'Fixed Picture',
          'Awning',
          'Bay',
          'Bow',
          'Garden',
          'Radius',
        ],
        getValue: () => _milgardOperationStyle,
        isApplicable: () => _isMilgard == true,
        onSelect: (value) => _milgardOperationStyle = value,
      ),
      _choiceStep(
        title: 'Opening Type',
        options: () => openingTypeOptions,
        getValue: () => _openingType,
        onSelect: (value) {
          _openingType = value;
          _calculateWindowRoughOpening();
        },
      ),
      _choiceStep(
        title: 'Window Size',
        options: () => _getWindowSizeOptions(),
        getValue: () => _windowSize,
        required: true,
        onSelect: (value) {
          _windowSize = value;
          _calculateWindowRoughOpening();
        },
      ),
      _WizardStep(
        build: () => _stepScaffold(
          title: 'Dimensions',
          content: Column(
            children: [
              TextFormField(
                controller: _widthController,
                decoration: const InputDecoration(labelText: 'Width'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _heightController,
                decoration: const InputDecoration(labelText: 'Height'),
              ),
            ],
          ),
          showContinue: true,
          onContinue: _advance,
        ),
      ),
      _choiceStep(
        title: 'Frame Material',
        options: () =>
            const ['Vinyl', 'Aluminum', 'Wood', 'Composite', 'Fiberglass'],
        getValue: () => _frameMaterial,
        onSelect: (value) => _frameMaterial = value,
      ),
      _WizardStep(
        isApplicable: () => _isMilgard == true,
        build: () => _stepScaffold(
          title: 'Milgard Finishes',
          content: Column(
            children: [
              TextFormField(
                controller: _milgardExteriorFinishController,
                decoration:
                    const InputDecoration(labelText: 'Exterior Finish'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _milgardInteriorFinishController,
                decoration:
                    const InputDecoration(labelText: 'Interior Finish'),
              ),
            ],
          ),
          showContinue: true,
          onContinue: _advance,
        ),
      ),
      _choiceStep(
        title: 'Color / Finish',
        options: () => const ['White', 'Bronze', 'Black', 'Almond'],
        getValue: () => _windowColor,
        isApplicable: () => _isMilgard == false,
        onSelect: (value) => _windowColor = value,
      ),
      _choiceStep(
        title: 'Glass Type',
        options: () => const [
          'Clear',
          'Obscure',
          'Low-E',
          'Low-E with Argon',
          'Tempered',
          'Laminated',
        ],
        getValue: () => _windowGlass,
        onSelect: (value) => _windowGlass = value,
      ),
      _choiceStep(
        title: 'Grid Pattern',
        options: () =>
            const ['None', 'Colonial', 'Prairie', 'Simulated Divided Light'],
        getValue: () => _gridPattern,
        onSelect: (value) => _gridPattern = value,
      ),
      _yesNoStep(
        title: 'Include Screen?',
        getValue: () => _screen,
        onSelect: (value) => _screen = value,
      ),
      _WizardStep(
        build: () => _stepScaffold(
          title: 'Quantity',
          content: _buildQuantityField(),
          showContinue: true,
          onContinue: _advance,
        ),
      ),
      _WizardStep(
        build: () => _stepScaffold(
          title: 'Special Conditions',
          content: TextFormField(
            controller: _windowSpecialController,
            decoration:
                const InputDecoration(labelText: 'Special Conditions'),
            maxLines: 3,
          ),
          showContinue: true,
          onContinue: _advance,
        ),
      ),
      _reviewStep(isDoor: false),
    ];
  }

  // ── Jamb Size step (buttons + a custom-entry fallback) ─────────────────

  _WizardStep _jambSizeStep() {
    return _WizardStep(
      build: () => _stepScaffold(
        title: 'Jamb Size',
        content: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _choiceGrid(
              options: _getJambSizes().map((e) => e.value as String).toList(),
              selected: _jambSize,
              onSelect: (value) {
                setState(() {
                  _jambSize = value;
                  _customJambSizeController.clear();
                });
                _advance();
              },
            ),
            const SizedBox(height: 20),
            Text(
              'Not on the list? Type your own:',
              style: TextStyle(color: Colors.grey.shade700),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _customJambSizeController,
                    decoration: const InputDecoration(
                      labelText: 'Custom Jamb Size',
                      hintText: 'e.g. 5-3/4"',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: () {
                    final custom = _customJambSizeController.text.trim();
                    if (custom.isEmpty) return;
                    setState(() => _jambSize = custom);
                    _advance();
                  },
                  child: const Text('Use'),
                ),
              ],
            ),
          ],
        ),
        showContinue: true,
        continueLabel: _jambSize == null ? 'Skip' : 'Continue',
      ),
    );
  }

  // ── Swing step (illustrated -- each option shows the real diagram) ─────

  static const List<(String code, String label, String asset)> _swingOptions = [
    ('LHIS', 'Left Hand Inswing', 'assets/swing_diagrams/left_hand_inswing.gif'),
    ('RHIS', 'Right Hand Inswing', 'assets/swing_diagrams/right_hand_inswing.gif'),
    ('LHOS', 'Left Hand Outswing', 'assets/swing_diagrams/left_hand_outswing.gif'),
    ('RHOS', 'Right Hand Outswing', 'assets/swing_diagrams/right_hand_outswing.gif'),
  ];

  Widget _swingCard(String code, String label, String asset) {
    final isSelected = _swing == code;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () {
        setState(() => _swing = code);
        _advance();
      },
      child: Container(
        width: 160,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          border: Border.all(
            color: isSelected ? Colors.blue : Colors.grey.shade300,
            width: isSelected ? 3 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
          color: isSelected ? Colors.blue.shade50 : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.asset(asset, height: 130, fit: BoxFit.contain),
            ),
            const SizedBox(height: 10),
            Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
            Text(
              code,
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
          ],
        ),
      ),
    );
  }

  _WizardStep _swingStep() {
    return _WizardStep(
      build: () => _stepScaffold(
        title: 'Swing',
        content: Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            for (final (code, label, asset) in _swingOptions)
              _swingCard(code, label, asset),
          ],
        ),
        showContinue: true,
        continueLabel: _swing == null ? 'Skip' : 'Continue',
      ),
    );
  }

  Widget _glassShapeCard(String name, String asset) {
    final isSelected = _glassShape == name;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => setState(() => _glassShape = name),
      child: Container(
        width: 120,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          border: Border.all(
            color: isSelected ? Colors.blue : Colors.grey.shade300,
            width: isSelected ? 3 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
          color: isSelected ? Colors.blue.shade50 : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.asset(asset, height: 80, fit: BoxFit.contain),
            ),
            const SizedBox(height: 8),
            Text(
              name,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  _WizardStep _glassShapeStep() {
    return _WizardStep(
      isApplicable: () => _doorLocation == 'Exterior' && !_isWoodDoor && _glassTint != null,
      build: () => _stepScaffold(
        title: 'Lite Shape',
        content: Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            for (final (name, asset) in glassShapeOptions) _glassShapeCard(name, asset),
          ],
        ),
        showContinue: true,
        onContinue: _advance,
        continueLabel: _glassShape == null ? 'Skip' : 'Continue',
      ),
    );
  }

  // ── Review step ──────────────────────────────────────────────────────────

  _WizardStep _reviewStep({required bool isDoor}) {
    return _WizardStep(
      build: () {
        final rows = isDoor
            ? [
                ('Location', _doorLocation),
                ('Material', _doorMaterial),
                ('Texture', _doorTexture),
                ('Style', _doorStyle),
                ('Panel Style', _panelStyle),
                ('Quantity', _quantity.toString()),
                ('Opening Type', _doorOpeningType),
                ('Size', _doorSize),
                ('Jamb Size', _jambSize),
                ('Swing', _swing),
                ('Hinge Size', _hingeSize),
                ('Hinge Finish', _hingeFinish),
                ('Exterior Trim', _exteriorTrim),
                ('Boring', _boring),
                ('Sill', _sill),
                ('Finish Type', _finishType),
                ('Wood Species / Stain Color', _finishDetail),
                ('Glass Tint', _glassTint),
                ('Lite Shape', _glassShape),
                ('Lite Style', _glassLiteStyle),
                ('Lite Frame', _frameProfile),
                ('Hardware', _hardwareOption),
                ('Q-lon', _qlon == null ? null : (_qlon! ? 'Yes' : 'No')),
                ('Special Conditions', _doorSpecialController.text),
              ]
            : [
                ('Milgard', _isMilgard == null ? null : (_isMilgard! ? 'Yes' : 'No')),
                ('Window Type', _windowType),
                ('Milgard Series', _milgardSeries),
                ('Milgard Operation Style', _milgardOperationStyle),
                ('Opening Type', _openingType),
                ('Size', _windowSize),
                ('Width', _widthController.text),
                ('Height', _heightController.text),
                ('Frame Material', _frameMaterial),
                ('Exterior Finish', _milgardExteriorFinishController.text),
                ('Interior Finish', _milgardInteriorFinishController.text),
                ('Color / Finish', _windowColor),
                ('Glass Type', _windowGlass),
                ('Grid Pattern', _gridPattern),
                ('Screen', _screen == null ? null : (_screen! ? 'Yes' : 'No')),
                ('Quantity', _quantity.toString()),
                ('Special Conditions', _windowSpecialController.text),
              ];

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Review',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 20),
            for (final (label, value) in rows)
              if (value != null && value.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 160,
                        child: Text(
                          label,
                          style: TextStyle(color: Colors.grey.shade700),
                        ),
                      ),
                      Expanded(
                        child: Text(
                          value,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _saveItem,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: Text(
                  widget.item == null ? 'Add Item' : 'Update Item',
                  style: const TextStyle(fontSize: 16),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  // ── Small shared widgets/helpers ────────────────────────────────────────

  Widget _buildQuantityField() {
    return Row(
      children: [
        const Text('Quantity:',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(width: 16),
        IconButton(
          icon: const Icon(Icons.remove_circle_outline),
          onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            border: Border.all(color: Colors.grey),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            _quantity.toString(),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.add_circle_outline),
          onPressed: () => setState(() => _quantity++),
        ),
      ],
    );
  }

  List<DropdownMenuItem<String>> _getDoorSizes() {
    final sizes = <String>[];
    for (var w = 10; w <= 72; w += 2) {
      sizes.add('${w.toString().padLeft(2, '0')}68');
    }
    for (var w = 10; w <= 72; w += 2) {
      sizes.add('${w.toString().padLeft(2, '0')}80');
    }
    return sizes
        .map((e) => DropdownMenuItem(value: e, child: Text(e)))
        .toList();
  }

  /// Whole-foot width x height codes from 2' to 8' each, e.g. "3040",
  /// "4050", "6060" - same WWHH format as door sizes, just both dimensions
  /// vary instead of a fixed height. Net Frame per the callout convention.
  List<String> _getWindowSizeOptions() {
    final sizes = <String>[];
    for (var w = 2; w <= 8; w++) {
      for (var h = 2; h <= 8; h++) {
        sizes.add('${(w * 10).toString().padLeft(2, '0')}${(h * 10).toString().padLeft(2, '0')}');
      }
    }
    return sizes;
  }

  /// Parses a WWHH callout code (e.g. "3068") into (width, height) inches.
  /// Returns null if the code doesn't parse as two feet+inches pairs.
  (double, double)? _parseSizeCode(String? code) {
    if (code == null || code.length < 4) return null;
    final widthCode = code.substring(0, 2);
    final heightCode = code.substring(2, 4);
    final widthFeet = int.tryParse(widthCode[0]);
    final widthInches = int.tryParse(widthCode[1]);
    final heightFeet = int.tryParse(heightCode[0]);
    final heightInches = int.tryParse(heightCode[1]);
    if (widthFeet == null ||
        widthInches == null ||
        heightFeet == null ||
        heightInches == null) {
      return null;
    }
    return (
      ((widthFeet * 12) + widthInches).toDouble(),
      ((heightFeet * 12) + heightInches).toDouble(),
    );
  }

  List<DropdownMenuItem<String>> _getJambSizes() {
    return [
      '4-9/16"',
      '4-5/8"',
      '4-11/16"',
      '5-1/4"',
      '5-3/8"',
      '6-9/16"',
      '6-5/8"',
      '6-11/16"',
      '7-1/4"'
    ].map((e) => DropdownMenuItem(value: e, child: Text(e))).toList();
  }

  void _calculateDoorRoughOpening() {
    // Rough Opening always calculates from Door Size, regardless of the
    // selected Opening Type; the customer can still overwrite it manually.
    if (_doorSize == null || _doorSize!.isEmpty) return;

    // Parse door size (e.g., "3068" -> 3'0" width (36"), 6'8" height (80"))
    // Format: [feet][inches][feet][inches]
    if (_doorSize!.length >= 4) {
      final widthCode = _doorSize!.substring(0, 2);
      final heightCode = _doorSize!.substring(2, 4);

      // Parse width: first digit is feet, second digit is inches
      final widthFeet = int.tryParse(widthCode[0]);
      final widthInches = int.tryParse(widthCode[1]);

      // Parse height: first digit is feet, second digit is inches
      final heightFeet = int.tryParse(heightCode[0]);
      final heightInches = int.tryParse(heightCode[1]);

      if (widthFeet != null &&
          widthInches != null &&
          heightFeet != null &&
          heightInches != null) {
        // Convert to total inches
        final doorWidthInches = (widthFeet * 12) + widthInches;
        final doorHeightInches = (heightFeet * 12) + heightInches;

        // For standard single prehung: door + 2" width, door + 2.25" height
        final roWidth = doorWidthInches + 2;
        final roHeight = doorHeightInches + 2.25;

        // Format height with fraction
        final roHeightWhole = roHeight.floor();
        final roHeightFraction = roHeight - roHeightWhole;
        String heightStr;
        if (roHeightFraction == 0.25) {
          heightStr = '$roHeightWhole-1/4"';
        } else if (roHeightFraction == 0.5) {
          heightStr = '$roHeightWhole-1/2"';
        } else if (roHeightFraction == 0.75) {
          heightStr = '$roHeightWhole-3/4"';
        } else {
          heightStr = '$roHeightWhole"';
        }

        _roughOpeningController.text = '$roWidth" × $heightStr';
      }
    }
  }

  // Format with fractions if needed
  String _formatDimension(double value) {
    final whole = value.floor();
    final fraction = value - whole;
    if (fraction == 0) return '$whole"';
    if (fraction == 0.25) return '$whole-1/4"';
    if (fraction == 0.5) return '$whole-1/2"';
    if (fraction == 0.75) return '$whole-3/4"';
    return '${value.toStringAsFixed(2)}"';
  }

  void _calculateWindowRoughOpening() {
    final parsed = _parseSizeCode(_windowSize);
    if (parsed == null) return;
    final (width, height) = parsed;

    _widthController.text = _formatDimension(width);
    _heightController.text = _formatDimension(height);

    double roWidth;
    double roHeight;

    // Calculate based on opening type
    if (_openingType == 'Finished Opening' || _openingType == 'Net Frame') {
      // For Finished Opening or Net Frame: rough opening is 1/2 inch MORE
      roWidth = width + 0.5;
      roHeight = height + 0.5;
    } else if (_openingType == 'Rough Opening') {
      // For Rough Opening: entered size IS the rough opening
      // (net unit would be 1/2 inch less, but we don't calculate that here)
      roWidth = width;
      roHeight = height;
    } else {
      // Default fallback
      roWidth = width + 0.5;
      roHeight = height + 0.5;
    }

    _windowRoController.text =
        '${_formatDimension(roWidth)} × ${_formatDimension(roHeight)}';
  }
}
