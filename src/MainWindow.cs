using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;

namespace CodexDreamSkinManager
{
    internal sealed class ResponsivePreviewBorder : Border
    {
        public double PreviewAspectRatio = 16.0 / 9.0;
        public double PreviewMinHeight = 280;
        public double PreviewMaxHeight = 420;

        protected override Size MeasureOverride(Size constraint)
        {
            double width = constraint.Width;
            if (double.IsNaN(width) || double.IsInfinity(width) || width <= 0) width = 800;
            double height = Math.Max(PreviewMinHeight,
                Math.Min(PreviewMaxHeight, width / PreviewAspectRatio));
            Size measured = base.MeasureOverride(new Size(constraint.Width, height));
            return new Size(double.IsInfinity(constraint.Width) ? measured.Width : constraint.Width, height);
        }
    }

    internal sealed class MainWindow : Window
    {
        private static readonly Brush BackgroundBrush = BrushFrom("#F4F6F8");
        private static readonly Brush SurfaceBrush = BrushFrom("#FFFFFF");
        private static readonly Brush PrimaryBrush = BrushFrom("#D8AE57");
        private static readonly Brush TextBrush = BrushFrom("#20242A");
        private static readonly Brush MutedBrush = BrushFrom("#68707B");
        private static readonly Brush AppBorderBrush = BrushFrom("#D9DEE5");
        private static readonly Brush SuccessBrush = BrushFrom("#16835B");
        private static readonly Brush WarningBrush = BrushFrom("#B35C00");
        private static readonly Brush DangerBrush = BrushFrom("#B42336");
        private static readonly Brush ButtonDisabledBackground = BrushFrom("#2A2926");
        private static readonly Brush ButtonDisabledForeground = BrushFrom("#827865");
        private static readonly Brush ButtonDisabledBorder = BrushFrom("#5B513D");
        private static readonly Brush ButtonFocusBrush = BrushFrom("#F4D580");
        private static readonly ButtonPalette PrimaryButtonPalette = new ButtonPalette(
            GoldGradient("#F1D58A", "#D2A84F"), BrushFrom("#18130B"), BrushFrom("#B98A34"),
            GoldGradient("#F6E1A7", "#DDB85F"), BrushFrom("#18130B"), BrushFrom("#D6AA54"),
            GoldGradient("#C7983B", "#B9852F"), BrushFrom("#18130B"), BrushFrom("#8F6927"));
        private static readonly ButtonPalette SecondaryButtonPalette = new ButtonPalette(
            BrushFrom("#111214"), BrushFrom("#E9CB7B"), BrushFrom("#80602C"),
            BrushFrom("#1B1812"), BrushFrom("#F6E3A8"), BrushFrom("#C79A44"),
            BrushFrom("#08090A"), BrushFrom("#F6E3A8"), BrushFrom("#9D722E"));
        private static readonly ButtonPalette DangerButtonPalette = new ButtonPalette(
            BrushFrom("#1B1113"), BrushFrom("#EFD2D6"), BrushFrom("#8E3442"),
            BrushFrom("#2A1418"), BrushFrom("#FFF0F1"), BrushFrom("#C24C5D"),
            BrushFrom("#11090B"), BrushFrom("#FFF0F1"), BrushFrom("#762A35"));

        private sealed class ButtonPalette
        {
            public readonly Brush NormalBackground;
            public readonly Brush NormalForeground;
            public readonly Brush NormalBorder;
            public readonly Brush HoverBackground;
            public readonly Brush HoverForeground;
            public readonly Brush HoverBorder;
            public readonly Brush PressedBackground;
            public readonly Brush PressedForeground;
            public readonly Brush PressedBorder;

            public ButtonPalette(Brush normalBackground, Brush normalForeground, Brush normalBorder,
                Brush hoverBackground, Brush hoverForeground, Brush hoverBorder,
                Brush pressedBackground, Brush pressedForeground, Brush pressedBorder)
            {
                NormalBackground = normalBackground;
                NormalForeground = normalForeground;
                NormalBorder = normalBorder;
                HoverBackground = hoverBackground;
                HoverForeground = hoverForeground;
                HoverBorder = hoverBorder;
                PressedBackground = pressedBackground;
                PressedForeground = pressedForeground;
                PressedBorder = pressedBorder;
            }
        }

        private readonly DreamSkinService service;
        private TextBlock statusText;
        private TextBlock activeThemeText;
        private TextBlock messageText;
        private Border statusDot;
        private ScrollViewer dashboardScroll;
        private ListBox themeList;
        private readonly List<ThemeOption> allThemes = new List<ThemeOption>();
        private TextBox themeSearchBox;
        private ComboBox themeCategoryCombo;
        private ListBox themeSourceSegment;
        private ComboBox themeSortCombo;
        private FrameworkElement emptyThemeState;
        private Button addImagesButton;
        private Button importPackageButton;
        private Button exportThemeButton;
        private Button deleteThemeButton;
        private Border previewSurface;
        private Border customPreviewSurface;
        private Image previewImageLayer;
        private Image customPreviewImageLayer;
        private BitmapSource dashboardPreviewBitmap;
        private ThemeOption dashboardPreviewTheme;
        private Brush dashboardPreviewMutedFill;
        private BitmapSource customPreviewBitmap;
        private Button enableButton;
        private Button pauseButton;
        private Button resetButton;
        private Button restoreButton;
        private Button refreshButton;
        private Button applyThemeButton;
        private Button saveThemeButton;
        private Button saveApplyButton;
        private TextBox imagePathBox;
        private TextBox themeNameBox;
        private TextBox accentBox;
        private Slider positionXSlider;
        private Slider positionYSlider;
        private Slider zoomSlider;
        private ListBox positionModeSegment;
        private TextBlock positionXValue;
        private TextBlock positionYValue;
        private TextBlock zoomValue;
        private ComboBox appearanceCombo;
        private ComboBox safeAreaCombo;
        private ComboBox taskModeCombo;
        private Button browseImageButton;
        private DreamSkinStatus currentStatus = new DreamSkinStatus();
        private readonly SemaphoreSlim statusRefreshLock = new SemaphoreSlim(1, 1);
        private bool operationRunning;
        private bool imageValidationRunning;
        private int imageValidationGeneration;
        private int statusRefreshCount;
        private bool suppressThemeSelection;
        private bool hasValidCustomImage;

        public MainWindow(DreamSkinService service)
        {
            this.service = service;
            Title = "Codex Dream Skin Manager";
            Width = 980;
            Height = 680;
            MinWidth = 760;
            MinHeight = 560;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = BackgroundBrush;
            FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI");
            Foreground = TextBrush;
            Content = BuildLayout();
            SizeChanged += delegate { UpdateThemeGridHeight(); };
            UpdateActionState();
            Loaded += async delegate { UpdateThemeGridHeight(); await RefreshStatusAsync(); };
        }

        public void SetStartupError(string message)
        {
            SetMessage(message, true);
            statusText.Text = "组件缺失";
            statusText.Foreground = DangerBrush;
            currentStatus.StatusKind = "error";
            UpdateActionState();
        }

        private UIElement BuildLayout()
        {
            Grid viewport = new Grid { Background = BackgroundBrush };
            Grid root = new Grid { MaxWidth = 1440, HorizontalAlignment = HorizontalAlignment.Stretch };
            AutomationProperties.SetName(root, "RootContent");
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.Margin = new Thickness(22);

            Border header = new Border { Background = SurfaceBrush, BorderBrush = AppBorderBrush, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(7), Padding = new Thickness(16, 12, 16, 12) };
            Grid headerGrid = new Grid();
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            StackPanel brand = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            Border mark = new Border { Width = 34, Height = 34, Background = BrushFrom("#0F1012"), CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 0, 10, 0) };
            mark.Child = new TextBlock { Text = "DS", Foreground = BrushFrom("#E9CB7B"), FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            brand.Children.Add(mark);
            brand.Children.Add(new TextBlock { Text = "Codex Dream Skin", FontSize = 17, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            headerGrid.Children.Add(brand);

            StackPanel statePanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            statusDot = new Border { Width = 9, Height = 9, Background = MutedBrush, CornerRadius = new CornerRadius(5), Margin = new Thickness(0, 0, 8, 0) };
            statePanel.Children.Add(statusDot);
            statusText = new TextBlock { Text = "正在读取状态...", VerticalAlignment = VerticalAlignment.Center, FontWeight = FontWeights.SemiBold };
            AutomationProperties.SetName(statusText, "StatusText");
            statePanel.Children.Add(statusText);
            Grid.SetColumn(statePanel, 1);
            headerGrid.Children.Add(statePanel);
            header.Child = headerGrid;
            root.Children.Add(header);

            TabControl tabs = new TabControl { Margin = new Thickness(0, 16, 0, 12), Background = Brushes.Transparent, BorderBrush = AppBorderBrush };
            TabItem dashboardTab = new TabItem { Header = "控制台", Content = BuildDashboard() };
            TabItem customTab = new TabItem { Header = "自定义换肤", Content = BuildCustomSkin() };
            AutomationProperties.SetName(customTab, "CustomSkinTab");
            tabs.Items.Add(dashboardTab);
            tabs.Items.Add(customTab);
            Grid.SetRow(tabs, 1);
            root.Children.Add(tabs);

            messageText = new TextBlock { Text = "选择主题可预览；执行启用或恢复前会请求确认。", Foreground = MutedBrush, TextWrapping = TextWrapping.Wrap };
            Grid.SetRow(messageText, 2);
            root.Children.Add(messageText);
            viewport.Children.Add(root);
            return viewport;
        }

        private UIElement BuildDashboard()
        {
            dashboardScroll = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                HorizontalContentAlignment = HorizontalAlignment.Stretch
            };
            dashboardScroll.SizeChanged += delegate { UpdateThemeGridHeight(); };
            AutomationProperties.SetName(dashboardScroll, "DashboardScroll");
            Grid grid = new Grid { Margin = new Thickness(4, 14, 4, 4), MaxWidth = 1260, HorizontalAlignment = HorizontalAlignment.Stretch };
            AutomationProperties.SetName(grid, "DashboardContent");
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(330) });

            StackPanel left = new StackPanel();
            TextBlock themesLabel = SectionLabel("主题库");
            themesLabel.Margin = new Thickness(0, 0, 0, 8);
            left.Children.Add(themesLabel);

            WrapPanel filterBar = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            themeSearchBox = InputBox("搜索名称或标签");
            themeSearchBox.Width = 220;
            themeSearchBox.Margin = new Thickness(0, 0, 8, 8);
            AutomationProperties.SetName(themeSearchBox, "ThemeSearch");
            themeSearchBox.TextChanged += delegate { ApplyThemeFilters(); };
            filterBar.Children.Add(themeSearchBox);

            themeCategoryCombo = CreateCombo(new[] { "全部分类", "梦幻", "自然", "赛博", "极简", "深色", "暖色", "未分类" }, 0);
            themeCategoryCombo.Width = 124;
            themeCategoryCombo.Margin = new Thickness(0, 0, 8, 8);
            AutomationProperties.SetName(themeCategoryCombo, "ThemeCategory");
            themeCategoryCombo.SelectionChanged += delegate { ApplyThemeFilters(); };
            filterBar.Children.Add(themeCategoryCombo);

            themeSourceSegment = new ListBox { Width = 174, Height = 36, BorderBrush = AppBorderBrush,
                BorderThickness = new Thickness(1), Background = SurfaceBrush, Padding = new Thickness(2),
                Margin = new Thickness(0, 0, 8, 8), SelectionMode = SelectionMode.Single };
            ScrollViewer.SetHorizontalScrollBarVisibility(themeSourceSegment, ScrollBarVisibility.Disabled);
            ScrollViewer.SetVerticalScrollBarVisibility(themeSourceSegment, ScrollBarVisibility.Disabled);
            themeSourceSegment.ItemsPanel = HorizontalStackItemsPanel();
            themeSourceSegment.ItemContainerStyle = SegmentedItemStyle(52, new Thickness(8, 5, 8, 5));
            themeSourceSegment.Items.Add("全部");
            themeSourceSegment.Items.Add("内置");
            themeSourceSegment.Items.Add("我的");
            themeSourceSegment.SelectedIndex = 0;
            AutomationProperties.SetName(themeSourceSegment, "ThemeSource");
            themeSourceSegment.SelectionChanged += delegate { ApplyThemeFilters(); };
            filterBar.Children.Add(themeSourceSegment);

            themeSortCombo = CreateCombo(new[] { "目录顺序", "名称排序" }, 0);
            themeSortCombo.Width = 118;
            themeSortCombo.Margin = new Thickness(0, 0, 0, 8);
            AutomationProperties.SetName(themeSortCombo, "ThemeSort");
            themeSortCombo.SelectionChanged += delegate { ApplyThemeFilters(); };
            filterBar.Children.Add(themeSortCombo);
            left.Children.Add(filterBar);

            WrapPanel commandBar = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            addImagesButton = SecondaryButton("添加图片");
            addImagesButton.Margin = new Thickness(0, 0, 8, 0);
            AutomationProperties.SetName(addImagesButton, "AddImagesButton");
            addImagesButton.Click += async delegate { await AddImagesAsync(); };
            commandBar.Children.Add(addImagesButton);
            importPackageButton = SecondaryButton("导入主题包");
            importPackageButton.Margin = new Thickness(0, 0, 8, 0);
            AutomationProperties.SetName(importPackageButton, "ImportPackageButton");
            importPackageButton.Click += async delegate { await ImportPackagesAsync(); };
            commandBar.Children.Add(importPackageButton);
            exportThemeButton = SecondaryButton("导出主题");
            exportThemeButton.Margin = new Thickness(0, 0, 8, 0);
            AutomationProperties.SetName(exportThemeButton, "ExportThemeButton");
            exportThemeButton.Click += ExportSelectedTheme;
            commandBar.Children.Add(exportThemeButton);
            deleteThemeButton = DangerButton("删除主题");
            deleteThemeButton.Margin = new Thickness(0);
            deleteThemeButton.Visibility = Visibility.Collapsed;
            AutomationProperties.SetName(deleteThemeButton, "DeleteThemeButton");
            deleteThemeButton.Click += async delegate { await DeleteSelectedThemeAsync(); };
            commandBar.Children.Add(deleteThemeButton);
            left.Children.Add(commandBar);

            Grid themeHost = new Grid();
            AutomationProperties.SetName(themeHost, "ThemeGridScroll");
            themeList = new ListBox { Height = 360, Background = SurfaceBrush, BorderBrush = AppBorderBrush,
                BorderThickness = new Thickness(1), Padding = new Thickness(6) };
            ScrollViewer.SetHorizontalScrollBarVisibility(themeList, ScrollBarVisibility.Disabled);
            ScrollViewer.SetVerticalScrollBarVisibility(themeList, ScrollBarVisibility.Auto);
            themeList.ItemsPanel = HorizontalItemsPanel();
            themeList.ItemTemplate = ThemeTemplate();
            themeList.SelectionChanged += ThemeSelectionChanged;
            AutomationProperties.SetName(themeList, "ThemeList");
            themeHost.Children.Add(themeList);
            StackPanel empty = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
            empty.Children.Add(new TextBlock { Text = "没有符合条件的主题", Foreground = MutedBrush,
                HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 8) });
            Button clearFilters = SecondaryButton("清除筛选");
            clearFilters.Click += delegate { ClearThemeFilters(); };
            empty.Children.Add(clearFilters);
            emptyThemeState = empty;
            themeHost.Children.Add(empty);
            left.Children.Add(themeHost);
            grid.Children.Add(left);

            Border controls = PanelBorder();
            controls.VerticalAlignment = VerticalAlignment.Top;
            AutomationProperties.SetName(controls, "DashboardControls");
            StackPanel controlStack = new StackPanel();
            previewSurface = CreatePreviewSurface("PreviewImage", 145, 180, 16.0 / 9.0);
            previewImageLayer = CreatePreviewImageLayer(previewSurface, "PreviewImageLayer");
            previewSurface.SizeChanged += delegate { ReapplyDashboardPreview(); };
            previewSurface.Margin = new Thickness(0, 0, 0, 14);
            controlStack.Children.Add(previewSurface);
            controlStack.Children.Add(SectionLabel("当前主题"));
            activeThemeText = new TextBlock { Text = "未选择", FontSize = 18, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 5, 0, 16) };
            controlStack.Children.Add(activeThemeText);

            applyThemeButton = SecondaryButton("应用选中主题");
            applyThemeButton.Margin = new Thickness(0, 16, 0, 8);
            applyThemeButton.Click += async delegate { await ApplySelectedThemeAsync(false); };
            controlStack.Children.Add(applyThemeButton);

            enableButton = PrimaryButton("启用皮肤");
            AutomationProperties.SetName(enableButton, "EnableButton");
            enableButton.Click += async delegate { await EnableAsync(); };
            controlStack.Children.Add(enableButton);

            pauseButton = SecondaryButton("暂停皮肤");
            pauseButton.Margin = new Thickness(0, 8, 0, 0);
            AutomationProperties.SetName(pauseButton, "PauseButton");
            pauseButton.Click += async delegate { await TogglePauseAsync(); };
            controlStack.Children.Add(pauseButton);

            resetButton = SecondaryButton("重置皮肤");
            resetButton.Margin = new Thickness(0, 8, 0, 0);
            resetButton.ToolTip = "恢复内置默认主题并清除暂停状态，不停止皮肤服务";
            AutomationProperties.SetName(resetButton, "ResetButton");
            resetButton.Click += async delegate { await ResetSkinAsync(); };

            refreshButton = SecondaryButton("刷新状态");
            refreshButton.Click += async delegate { await RefreshStatusAsync(); };

            Grid utilityRow = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            utilityRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            utilityRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            utilityRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            resetButton.Margin = new Thickness(0);
            refreshButton.Margin = new Thickness(0);
            utilityRow.Children.Add(resetButton);
            Grid.SetColumn(refreshButton, 2);
            utilityRow.Children.Add(refreshButton);
            controlStack.Children.Add(utilityRow);

            restoreButton = DangerButton("紧急恢复原始外观");
            restoreButton.Margin = new Thickness(0, 8, 0, 0);
            restoreButton.ToolTip = "管理脚本异常时仍可直接调用恢复脚本";
            AutomationProperties.SetName(restoreButton, "RestoreButton");
            restoreButton.Click += async delegate { await RestoreAsync(); };
            controlStack.Children.Add(restoreButton);
            controls.Child = controlStack;
            Grid.SetColumn(controls, 2);
            grid.Children.Add(controls);
            dashboardScroll.Content = grid;
            return dashboardScroll;
        }

        private UIElement BuildCustomSkin()
        {
            ScrollViewer scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalContentAlignment = HorizontalAlignment.Stretch };
            Grid grid = new Grid { Margin = new Thickness(4, 14, 4, 4), MaxWidth = 1260, HorizontalAlignment = HorizontalAlignment.Stretch };
            AutomationProperties.SetName(grid, "CustomThemeContent");
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(380) });
            customPreviewSurface = CreatePreviewSurface("CustomPreviewImage", 330, 480, 16.0 / 9.0);
            customPreviewImageLayer = CreatePreviewImageLayer(customPreviewSurface, "CustomPreviewImageLayer");
            customPreviewSurface.IsHitTestVisible = false;
            customPreviewSurface.SizeChanged += delegate { UpdateCustomPreview(); };
            grid.Children.Add(customPreviewSurface);

            Border panel = PanelBorder();
            panel.VerticalAlignment = VerticalAlignment.Top;
            AutomationProperties.SetName(panel, "CustomThemeControls");
            StackPanel fields = new StackPanel();
            fields.Children.Add(FieldLabel("主题名称"));
            themeNameBox = InputBox("例如：我的工作台");
            fields.Children.Add(themeNameBox);
            fields.Children.Add(FieldLabel("背景图片"));
            Grid fileRow = new Grid();
            fileRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            fileRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            imagePathBox = InputBox("选择 PNG、JPG 或 WebP");
            imagePathBox.IsReadOnly = true;
            fileRow.Children.Add(imagePathBox);
            browseImageButton = SecondaryButton("选择图片");
            browseImageButton.Margin = new Thickness(8, 0, 0, 0);
            browseImageButton.Click += async delegate { await BrowseImageAsync(); };
            Grid.SetColumn(browseImageButton, 1);
            fileRow.Children.Add(browseImageButton);
            fields.Children.Add(fileRow);

            fields.Children.Add(FieldLabel("外观模式"));
            appearanceCombo = CreateCombo(new[] { "自动", "浅色", "深色" }, 0);
            fields.Children.Add(appearanceCombo);

            positionXValue = new TextBlock { Text = "0%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("水平位置", positionXValue));
            positionXSlider = CreateSlider(-100, 100, 0, 10, "HorizontalPositionSlider");
            positionXSlider.ValueChanged += FramingChanged;
            fields.Children.Add(positionXSlider);
            positionYValue = new TextBlock { Text = "0%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("垂直位置", positionYValue));
            positionYSlider = CreateSlider(-100, 100, 0, 10, "VerticalPositionSlider");
            positionYSlider.ValueChanged += FramingChanged;
            fields.Children.Add(positionYSlider);
            zoomValue = new TextBlock { Text = "100%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("缩放", zoomValue));
            zoomSlider = CreateSlider(100, 200, 100, 10, "ZoomSlider");
            zoomSlider.ValueChanged += FramingChanged;
            fields.Children.Add(zoomSlider);
            Grid framingModeRow = new Grid { Margin = new Thickness(0, 8, 0, 2),
                HorizontalAlignment = HorizontalAlignment.Left };
            framingModeRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            framingModeRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            positionModeSegment = new ListBox { Height = 38, Background = BackgroundBrush,
                BorderBrush = AppBorderBrush, BorderThickness = new Thickness(1),
                Padding = new Thickness(2), SelectionMode = SelectionMode.Single,
                HorizontalAlignment = HorizontalAlignment.Left };
            ScrollViewer.SetHorizontalScrollBarVisibility(positionModeSegment, ScrollBarVisibility.Disabled);
            ScrollViewer.SetVerticalScrollBarVisibility(positionModeSegment, ScrollBarVisibility.Disabled);
            positionModeSegment.ItemsPanel = HorizontalStackItemsPanel();
            positionModeSegment.ItemContainerStyle = SegmentedItemStyle(76, new Thickness(12, 6, 12, 6));
            positionModeSegment.Items.Add("锁定区域内");
            positionModeSegment.Items.Add("不锁定区域");
            positionModeSegment.SelectedIndex = 0;
            AutomationProperties.SetName(positionModeSegment, "PositionMode");
            positionModeSegment.SelectionChanged += delegate { UpdateCustomPreview(); };
            framingModeRow.Children.Add(positionModeSegment);
            Button resetFraming = SecondaryButton("复位");
            resetFraming.Margin = new Thickness(8, 0, 0, 0);
            AutomationProperties.SetName(resetFraming, "ResetFramingButton");
            resetFraming.Click += delegate { ResetFramingControls(); };
            Grid.SetColumn(resetFraming, 1);
            framingModeRow.Children.Add(resetFraming);
            fields.Children.Add(framingModeRow);

            fields.Children.Add(FieldLabel("文字安全区"));
            safeAreaCombo = CreateCombo(new[] { "自动", "左侧", "右侧", "居中", "关闭" }, 0);
            fields.Children.Add(safeAreaCombo);
            fields.Children.Add(FieldLabel("任务页模式"));
            taskModeCombo = CreateCombo(new[] { "自动", "氛围", "横幅", "完整", "关闭" }, 0);
            fields.Children.Add(taskModeCombo);

            fields.Children.Add(FieldLabel("主题强调色"));
            Grid colorRow = new Grid();
            colorRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            colorRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            accentBox = InputBox("#B65CFF");
            accentBox.Text = "#B65CFF";
            colorRow.Children.Add(accentBox);
            Button colorButton = SecondaryButton("选择颜色");
            colorButton.Margin = new Thickness(8, 0, 0, 0);
            colorButton.Click += PickColor;
            Grid.SetColumn(colorButton, 1);
            colorRow.Children.Add(colorButton);
            fields.Children.Add(colorRow);

            Grid saveRow = new Grid { Margin = new Thickness(0, 18, 0, 0) };
            saveRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            saveRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            saveRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            saveThemeButton = SecondaryButton("保存主题");
            saveThemeButton.Click += async delegate { await SaveCustomAsync(false); };
            saveRow.Children.Add(saveThemeButton);
            saveApplyButton = PrimaryButton("保存并应用");
            saveApplyButton.Click += async delegate { await SaveCustomAsync(true); };
            Grid.SetColumn(saveApplyButton, 2);
            saveRow.Children.Add(saveApplyButton);
            fields.Children.Add(saveRow);

            panel.Child = fields;
            Grid.SetColumn(panel, 2);
            grid.Children.Add(panel);
            scroll.Content = grid;
            return scroll;
        }

        private async Task<bool> RefreshStatusAsync(bool reportErrors = true)
        {
            if (service == null)
            {
                currentStatus.StatusKind = "error";
                UpdateActionState();
                return false;
            }
            statusRefreshCount++;
            UpdateActionState();
            await statusRefreshLock.WaitAsync();
            try
            {
                DreamSkinStatus previousStatus = currentStatus;
                try
                {
                    currentStatus = await service.GetStatusAsync();
                    UpdateStatusDisplay(currentStatus);
                    PopulateThemes(currentStatus.Themes);
                    RefreshDashboardPreview();
                    UpdateActionState();
                    return true;
                }
                catch (Exception ex)
                {
                    // Keep the last known state actionable when a post-operation status
                    // read fails transiently while the watcher reloads the new theme.
                    if (reportErrors)
                    {
                        currentStatus.StatusKind = "error";
                        currentStatus.StatusMessage = ex.Message;
                        currentStatus.IsRunning = false;
                    }
                    else
                    {
                        currentStatus = previousStatus;
                        // A post-operation read can race the watcher while it
                        // reloads the newly selected theme. Keep the last
                        // known state visible instead of replacing it with a
                        // misleading generic failure label.
                        UpdateStatusDisplay(currentStatus);
                    }
                    if (reportErrors)
                    {
                        SetMessage(ex.Message, true);
                        statusText.Text = "状态读取失败";
                        statusText.Foreground = DangerBrush;
                        statusDot.Background = DangerBrush;
                    }
                    UpdateActionState();
                    return false;
                }
            }
            finally
            {
                statusRefreshLock.Release();
                statusRefreshCount--;
                UpdateActionState();
            }
        }

        private void UpdateStatusDisplay(DreamSkinStatus status)
        {
            if (status == null) status = new DreamSkinStatus();
            bool unhealthy = status.StatusKind == "mismatch" ||
                status.StatusKind == "uninspectable" || status.StatusKind == "error";
            bool pausedWhileRunning = status.IsRunning && status.IsPaused;
            statusText.Text = unhealthy ? "状态需要恢复" : pausedWhileRunning ? "皮肤已暂停" : status.IsRunning ? "皮肤运行中" : "皮肤未运行";
            statusText.Foreground = unhealthy ? DangerBrush : status.IsRunning ? pausedWhileRunning ? WarningBrush : SuccessBrush : MutedBrush;
            statusDot.Background = unhealthy ? DangerBrush : status.IsRunning ? pausedWhileRunning ? WarningBrush : SuccessBrush : MutedBrush;
            statusText.ToolTip = BuildStatusDetails(status);
            activeThemeText.Text = string.IsNullOrWhiteSpace(status.ActiveThemeName) ? "未选择" : CleanThemeName(status.ActiveThemeName);
        }

        private void PopulateThemes(List<ThemeOption> themes)
        {
            allThemes.Clear();
            foreach (ThemeOption theme in themes ?? new List<ThemeOption>())
            {
                theme.Name = CleanThemeName(theme.Name);
                if (theme.Name == "已保存主题" && !string.IsNullOrWhiteSpace(theme.Id))
                    theme.Name += " " + theme.Id.Substring(Math.Max(0, theme.Id.Length - Math.Min(6, theme.Id.Length)));
                allThemes.Add(theme);
            }
            ApplyThemeFilters();
        }

        private void ApplyThemeFilters()
        {
            if (themeList == null) return;
            ThemeOption selected = themeList.SelectedItem as ThemeOption;
            string selectedId = selected == null ? "" : selected.Id;
            string search = themeSearchBox == null ? "" : themeSearchBox.Text;
            string category = MapCategory(themeCategoryCombo == null ? 0 : themeCategoryCombo.SelectedIndex);
            string source = MapSource(themeSourceSegment == null ? 0 : themeSourceSegment.SelectedIndex);
            string sort = themeSortCombo != null && themeSortCombo.SelectedIndex == 1 ? "name" : "catalog";
            List<ThemeOption> filtered = ThemeLibraryFilter.Apply(allThemes, search, category, source, sort);
            suppressThemeSelection = true;
            try
            {
                themeList.Items.Clear();
                foreach (ThemeOption theme in filtered) themeList.Items.Add(theme);
                for (int i = 0; i < themeList.Items.Count; i++)
                    if (((ThemeOption)themeList.Items[i]).Id == selectedId) themeList.SelectedIndex = i;
            }
            finally { suppressThemeSelection = false; }
            if (emptyThemeState != null) emptyThemeState.Visibility = filtered.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            UpdateActionState();
        }

        private void ClearThemeFilters()
        {
            if (themeSearchBox != null) themeSearchBox.Text = "";
            if (themeCategoryCombo != null) themeCategoryCombo.SelectedIndex = 0;
            if (themeSourceSegment != null) themeSourceSegment.SelectedIndex = 0;
            if (themeSortCombo != null) themeSortCombo.SelectedIndex = 0;
            ApplyThemeFilters();
        }

        private void UpdateThemeGridHeight()
        {
            if (themeList == null || dashboardScroll == null) return;
            double viewportHeight = dashboardScroll.ViewportHeight;
            if (viewportHeight <= 0 || double.IsNaN(viewportHeight) || double.IsInfinity(viewportHeight))
                viewportHeight = dashboardScroll.ActualHeight;
            if (viewportHeight <= 0) return;
            try
            {
                Point top = themeList.TranslatePoint(new Point(0, 0), dashboardScroll);
                double available = viewportHeight - Math.Max(0, top.Y) - 4;
                if (available > 0)
                    themeList.Height = Math.Max(1, Math.Min(610, Math.Floor(available)));
            }
            catch (InvalidOperationException) { }
        }

        private void ThemeSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (suppressThemeSelection) return;
            ThemeOption theme = themeList.SelectedItem as ThemeOption;
            UpdateActionState();
            if (theme == null)
            {
                ClearDashboardPreview();
                return;
            }
            try
            {
                BitmapSource bitmap = LoadPreviewBitmap(theme.ImagePath);
                if (bitmap == null)
                {
                    ClearDashboardPreview();
                }
                else
                {
                    dashboardPreviewBitmap = bitmap;
                    dashboardPreviewTheme = theme;
                    dashboardPreviewMutedFill = PreviewMath.UsesCustomFraming(theme.FramingEnabled,
                        theme.PositionX, theme.PositionY, theme.Zoom, theme.PositionMode)
                        ? CreateMutedImageFill(bitmap) : null;
                    ApplyThemePreview(previewSurface, previewImageLayer, bitmap, theme, dashboardPreviewMutedFill);
                }
                SetMessage("已预览：" + theme.Name, false);
            }
            catch (Exception ex)
            {
                ClearDashboardPreview();
                SetMessage("主题预览失败：" + ex.Message, true);
            }
        }

        private async Task ApplySelectedThemeAsync(bool restart)
        {
            ThemeOption theme = themeList.SelectedItem as ThemeOption;
            if (theme == null) { SetMessage("请先选择一个主题。", true); return; }
            ActionAvailability availability = ActionAvailability.FromStatus(currentStatus, false, true, hasValidCustomImage);
            bool restartAfterApply = restart || availability.RestartAfterApply;
            if (restartAfterApply && !(availability.RequiresRecovery
                ? ConfirmThemeRecoveryRestart(theme.Name)
                : ConfirmRestart("应用主题"))) return;
            await RunOperationAsync(async delegate
            {
                if (restartAfterApply)
                {
                    if (availability.RequiresRecovery)
                    {
                        await service.ApplyThemeAndRecoverAsync(theme);
                    }
                    else
                    {
                        await service.ApplyThemeAsync(theme);
                        await service.StartAsync(true);
                    }
                    SetExpectedRuntimeState(true, false);
                }
                else
                {
                    await service.ApplyThemeAsync(theme);
                    SetExpectedRuntimeState(currentStatus.IsRunning, false);
                }
            }, restartAfterApply ? "主题已应用，Codex 已重新启动。" : "主题已应用。");
        }

        private async Task DeleteSelectedThemeAsync()
        {
            ThemeOption theme = themeList == null ? null : themeList.SelectedItem as ThemeOption;
            if (!IsSavedTheme(theme)) { SetMessage("只能删除“我的”已保存主题。", true); return; }
            if (string.Equals(theme.Id, currentStatus.ActiveThemeId, StringComparison.OrdinalIgnoreCase))
            {
                SetMessage("当前正在使用该主题，请先应用其他主题后再删除。", true);
                return;
            }
            string message = "将永久删除“" + theme.Name + "”及其本地图片。此操作无法撤销。是否继续？";
            if (MessageBox.Show(this, message, "确认删除主题", MessageBoxButton.YesNo,
                MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            ThemeDeletionResult result = null;
            await RunOperationAsync(async delegate { result = await service.DeleteThemeAsync(theme); }, "主题已删除。");
            if (result != null && result.CleanupPending)
                SetMessage("主题已从主题库移除，但部分本地文件暂未清理。", true);
        }

        internal static bool IsSavedTheme(ThemeOption theme)
        {
            return theme != null && !theme.IsPreset &&
                string.Equals(theme.Source, "saved", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(theme.ThemeDirectory);
        }

        private async Task EnableAsync()
        {
            if (!ConfirmRestart("启用皮肤")) return;
            await RunOperationAsync(async delegate
            {
                await service.StartAsync(true);
                SetExpectedRuntimeState(true, false);
            }, "皮肤已启用，Codex 已重新启动。");
        }

        private async Task TogglePauseAsync()
        {
            bool pause = !currentStatus.IsPaused;
            await RunOperationAsync(async delegate
            {
                await service.SetPausedAsync(pause);
                SetExpectedRuntimeState(currentStatus.IsRunning, pause);
            }, pause ? "皮肤已暂停。" : "皮肤已继续显示。");
        }

        private async Task ResetSkinAsync()
        {
            await RunOperationAsync(async delegate
            {
                await service.ResetThemeAsync();
                SetExpectedRuntimeState(currentStatus.IsRunning, false);
            }, "皮肤已重置为默认主题。");
        }

        private async Task RestoreAsync()
        {
            if (!ConfirmRestart("恢复原始外观")) return;
            await RunOperationAsync(async delegate
            {
                await service.RestoreAsync(true);
                SetExpectedRuntimeState(false, false);
            }, "Codex 已恢复原始外观。");
        }

        private async Task SaveCustomAsync(bool apply)
        {
            CustomThemeOptions options = ReadCustomOptions();
            try { options.Validate(); } catch (Exception ex) { SetMessage(ex.Message, true); return; }
            if (apply && !ConfirmRestart("应用自定义主题")) return;
            await RunOperationAsync(async delegate
            {
                await service.ImportThemeAsync(options, !apply);
                if (apply)
                {
                    await service.StartAsync(true);
                    SetExpectedRuntimeState(true, false);
                }
            }, apply ? "自定义主题已保存并应用。" : "自定义主题已保存。");
        }

        private CustomThemeOptions ReadCustomOptions()
        {
            CustomThemeOptions options = new CustomThemeOptions();
            options.Name = themeNameBox.Text.Trim();
            options.ImagePath = imagePathBox.Text.Trim();
            options.Appearance = MapAppearance(appearanceCombo == null ? 0 : appearanceCombo.SelectedIndex);
            options.SetFramingPercent(positionXSlider.Value, positionYSlider.Value, zoomSlider.Value);
            options.PositionMode = positionModeSegment != null && positionModeSegment.SelectedIndex == 1 ? "free" : "locked";
            options.SafeArea = MapSafeArea(safeAreaCombo.SelectedIndex);
            options.TaskMode = MapTaskMode(taskModeCombo.SelectedIndex);
            options.Accent = accentBox.Text.Trim();
            return options;
        }

        private void SetExpectedRuntimeState(bool running, bool paused)
        {
            currentStatus.IsRunning = running;
            currentStatus.IsPaused = paused;
            currentStatus.StatusKind = running ? (paused ? "paused" : "running") : "stopped";
            currentStatus.StatusMessage = "";
        }

        private async Task RunOperationAsync(Func<Task> action, string success)
        {
            if (operationRunning || statusRefreshCount > 0 || service == null) return;
            operationRunning = true;
            UpdateActionState();
            SetMessage("正在执行...", false);
            string finalMessage = success;
            bool finalError = false;
            try
            {
                await action();
            }
            catch (Exception ex)
            {
                finalMessage = ex.Message;
                finalError = true;
            }
            bool refreshed = false;
            try
            {
                refreshed = await RefreshStatusAsync(false);
            }
            catch (Exception ex)
            {
                if (!finalError)
                {
                    finalMessage = ex.Message;
                    finalError = true;
                }
            }
            finally
            {
                operationRunning = false;
                UpdateActionState();
            }
            if (!refreshed && !finalError)
            {
                finalMessage = success + " 状态刷新失败，请点击刷新状态重试。";
                finalError = true;
            }
            SetMessage(finalMessage, finalError);
        }

        private async Task BrowseImageAsync()
        {
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Title = "选择背景图片";
            dialog.Filter = "图片文件|*.png;*.jpg;*.jpeg;*.webp";
            if (dialog.ShowDialog(this) == true)
            {
                int validationGeneration = ++imageValidationGeneration;
                imageValidationRunning = true;
                hasValidCustomImage = false;
                imagePathBox.Text = "";
                customPreviewBitmap = null;
                customPreviewImageLayer.Source = null;
                customPreviewSurface.Background = BrushFrom("#E3E8EE");
                UpdateActionState();
                SetMessage("正在验证图片...", false);
                try
                {
                    if (service == null) throw new InvalidOperationException("管理组件不可用，无法验证图片。");
                    ImageValidationResult validation = await service.ValidateImageAsync(dialog.FileName);
                    if (validationGeneration != imageValidationGeneration) return;
                    imagePathBox.Text = validation.Path;
                    if (validation.CanPreview)
                    {
                        customPreviewBitmap = LoadPreviewBitmap(validation.Path);
                        customPreviewSurface.Background = CreateMutedImageFill(customPreviewBitmap);
                        UpdateCustomPreview();
                    }
                    else
                    {
                        customPreviewBitmap = null;
                        customPreviewImageLayer.Source = null;
                        customPreviewSurface.Background = BrushFrom("#E3E8EE");
                    }
                    hasValidCustomImage = true;
                    string details = validation.Width + " x " + validation.Height + " · " + validation.Format.ToUpperInvariant();
                    SetMessage(string.IsNullOrWhiteSpace(validation.PreviewMessage) ? "图片验证通过：" + details : validation.PreviewMessage + " " + details, false);
                }
                catch (Exception ex)
                {
                    if (validationGeneration != imageValidationGeneration) return;
                    hasValidCustomImage = false;
                    imagePathBox.Text = "";
                    customPreviewBitmap = null;
                    customPreviewImageLayer.Source = null;
                    customPreviewSurface.Background = BrushFrom("#E3E8EE");
                    SetMessage(ex.Message, true);
                }
                finally
                {
                    if (validationGeneration == imageValidationGeneration) imageValidationRunning = false;
                    UpdateActionState();
                }
            }
        }

        private async Task AddImagesAsync()
        {
            if (operationRunning || statusRefreshCount > 0) return;
            OpenFileDialog dialog = new OpenFileDialog {
                Title = "添加背景图片",
                Filter = "图片文件|*.png;*.jpg;*.jpeg;*.webp",
                Multiselect = true
            };
            if (dialog.ShowDialog(this) != true) return;
            if (dialog.FileNames.Length > 50) { SetMessage("一次最多添加 50 张图片。", true); return; }
            List<BatchImportItem> items = new List<BatchImportItem>();
            foreach (string file in dialog.FileNames)
                items.Add(new BatchImportItem { ImagePath = file, Name = Path.GetFileNameWithoutExtension(file) });
            await ImportItemsAsync(items, 0);
        }

        private async Task ImportPackagesAsync()
        {
            if (operationRunning || statusRefreshCount > 0) return;
            OpenFileDialog dialog = new OpenFileDialog {
                Title = "导入主题包",
                Filter = "Codex Dream Skin 主题包|*.cdskin",
                Multiselect = true
            };
            if (dialog.ShowDialog(this) != true) return;
            if (dialog.FileNames.Length > 50) { SetMessage("一次最多导入 50 个主题包。", true); return; }
            if (operationRunning || service == null) return;
            List<BatchImportItem> items = new List<BatchImportItem>();
            List<string> extractionRoots = new List<string>();
            int invalid = 0;
            SetMessage("正在读取主题包...", false);
            try
            {
                foreach (string package in dialog.FileNames)
                {
                    string root = Path.Combine(Path.GetTempPath(), "CodexDreamSkinManager", "package-" + Guid.NewGuid().ToString("N"));
                    extractionRoots.Add(root);
                    try
                    {
                        ThemePackageData data = ThemePackageService.ReadPackage(package, root);
                        items.Add(CreateBatchImportItem(data));
                    }
                    catch { invalid++; }
                }
                if (items.Count == 0) { SetMessage("所选主题包均未通过安全检查。", true); return; }
                await ImportItemsAsync(items, invalid);
            }
            finally
            {
                foreach (string root in extractionRoots)
                    try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
            }
        }

        internal static BatchImportItem CreateBatchImportItem(ThemePackageData data)
        {
            if (data == null) throw new ArgumentNullException("data");
            return new BatchImportItem {
                ImagePath = data.ImagePath, Name = data.Name, Appearance = data.Appearance,
                FocusX = data.FocusX, FocusY = data.FocusY, SafeArea = data.SafeArea,
                PositionX = data.PositionX, PositionY = data.PositionY, Zoom = data.Zoom,
                PositionMode = data.PositionMode, FramingEnabled = data.FramingEnabled,
                TaskMode = data.TaskMode, Accent = data.Accent, Category = data.Category,
                Tags = new List<string>(data.Tags ?? new List<string>()),
                SafeCssPath = data.SafeCssPath, LicensePath = data.LicensePath
            };
        }

        private async Task ImportItemsAsync(IList<BatchImportItem> items, int preflightFailures)
        {
            if (operationRunning || statusRefreshCount > 0 || service == null || items == null || items.Count == 0) return;
            operationRunning = true;
            UpdateActionState();
            SetMessage("正在导入 " + items.Count + " 个主题...", false);
            string message;
            bool error = false;
            try
            {
                BatchImportResult result = await service.ImportBatchAsync(items);
                int failed = result.Failed + preflightFailures;
                message = "导入完成：新增 " + result.Imported + "，重复跳过 " + result.Skipped + "，失败 " + failed + "。";
                error = failed > 0;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                error = true;
            }
            bool refreshed = false;
            try
            {
                refreshed = await RefreshStatusAsync(false);
            }
            catch (Exception ex)
            {
                if (!error)
                {
                    message = ex.Message;
                    error = true;
                }
            }
            finally
            {
                operationRunning = false;
                UpdateActionState();
            }
            if (!refreshed && !error)
            {
                message += " 状态刷新失败，请点击刷新状态重试。";
                error = true;
            }
            SetMessage(message, error);
        }

        private void ExportSelectedTheme(object sender, RoutedEventArgs e)
        {
            ThemeOption theme = themeList == null ? null : themeList.SelectedItem as ThemeOption;
            if (theme == null) { SetMessage("请先选择需要导出的主题。", true); return; }
            SaveFileDialog dialog = new SaveFileDialog {
                Title = "导出主题包",
                Filter = "Codex Dream Skin 主题包|*.cdskin",
                FileName = SafeFileName(theme.Name) + ".cdskin",
                DefaultExt = ".cdskin",
                AddExtension = true,
                OverwritePrompt = true
            };
            if (dialog.ShowDialog(this) != true) return;
            try
            {
                ThemePackageData data = new ThemePackageData {
                    Id = string.IsNullOrWhiteSpace(theme.Id) ? "custom" : theme.Id,
                    Name = theme.Name, ImagePath = theme.ImagePath, Category = theme.Category,
                    Tags = new List<string>(theme.Tags ?? new List<string>()), Appearance = theme.Appearance,
                    FocusX = theme.FocusX, FocusY = theme.FocusY, SafeArea = theme.SafeArea,
                    PositionX = theme.PositionX, PositionY = theme.PositionY, Zoom = theme.Zoom,
                    PositionMode = theme.PositionMode, FramingEnabled = theme.FramingEnabled,
                    TaskMode = theme.TaskMode, Accent = theme.Accent
                };
                if (!string.IsNullOrWhiteSpace(theme.ThemeDirectory)) {
                    string css = Path.Combine(theme.ThemeDirectory, "theme.css");
                    string license = Path.Combine(theme.ThemeDirectory, "LICENSE.txt");
                    if (File.Exists(css)) data.SafeCssPath = css;
                    if (File.Exists(license)) data.LicensePath = license;
                }
                ThemePackageService.WritePackage(dialog.FileName, data);
                SetMessage("主题包已导出：" + Path.GetFileName(dialog.FileName), false);
            }
            catch (Exception ex) { SetMessage(ex.Message, true); }
        }

        private static string SafeFileName(string name)
        {
            string value = string.IsNullOrWhiteSpace(name) ? "theme" : name.Trim();
            foreach (char invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
            return value;
        }

        private void PickColor(object sender, RoutedEventArgs e)
        {
            using (System.Windows.Forms.ColorDialog dialog = new System.Windows.Forms.ColorDialog())
            {
                dialog.FullOpen = true;
                if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                    accentBox.Text = "#" + dialog.Color.R.ToString("X2") + dialog.Color.G.ToString("X2") + dialog.Color.B.ToString("X2");
            }
        }

        private void FramingChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (positionXValue == null || positionYValue == null || zoomValue == null) return;
            positionXValue.Text = FormatSignedPercent(positionXSlider.Value);
            positionYValue.Text = FormatSignedPercent(positionYSlider.Value);
            zoomValue.Text = Math.Round(zoomSlider.Value) + "%";
            UpdateCustomPreview();
        }

        private void ResetFramingControls()
        {
            positionXSlider.Value = 0;
            positionYSlider.Value = 0;
            zoomSlider.Value = 100;
            UpdateCustomPreview();
        }

        private static string FormatSignedPercent(double value)
        {
            double rounded = Math.Round(value);
            return (rounded > 0 ? "+" : "") + rounded + "%";
        }

        private void UpdateActionState()
        {
            ThemeOption selectedTheme = themeList == null ? null : themeList.SelectedItem as ThemeOption;
            bool selected = selectedTheme != null;
            bool busy = operationRunning || statusRefreshCount > 0 || imageValidationRunning;
            ActionAvailability state = ActionAvailability.FromStatus(currentStatus, busy, selected, hasValidCustomImage);
            if (enableButton != null) { enableButton.IsEnabled = state.CanEnable && service != null && service.CanManage; enableButton.Content = state.EnableLabel; }
            if (pauseButton != null) { pauseButton.IsEnabled = state.CanPause && service != null && service.CanManage; pauseButton.Content = state.PauseLabel; }
            if (resetButton != null) resetButton.IsEnabled = state.CanReset && service != null && service.CanManage;
            if (restoreButton != null) restoreButton.IsEnabled = state.CanRestore && service != null && service.CanRestore;
            if (refreshButton != null) refreshButton.IsEnabled = !busy && service != null && service.CanManage;
            if (applyThemeButton != null)
            {
                bool canRunApply = service != null && (state.RequiresRecovery ? service.CanRecover : service.CanManage);
                applyThemeButton.IsEnabled = state.CanApplyTheme && canRunApply;
                applyThemeButton.Content = state.RestartAfterApply ? "应用并重启 Codex" : "应用选中主题";
                applyThemeButton.ToolTip = state.RequiresRecovery
                    ? "安全检查通过后应用选中主题并重启 Codex"
                    : state.RestartAfterApply ? "应用选中主题并重启 Codex" : null;
            }
            if (addImagesButton != null) addImagesButton.IsEnabled = !busy && service != null && service.CanManage;
            if (browseImageButton != null) browseImageButton.IsEnabled = !busy && service != null && service.CanManage;
            if (importPackageButton != null) importPackageButton.IsEnabled = !busy && service != null && service.CanManage;
            if (exportThemeButton != null) exportThemeButton.IsEnabled = selected && !busy;
            if (deleteThemeButton != null)
            {
                bool savedTheme = IsSavedTheme(selectedTheme);
                bool activeTheme = savedTheme && !string.IsNullOrWhiteSpace(currentStatus.ActiveThemeId) &&
                    string.Equals(selectedTheme.Id, currentStatus.ActiveThemeId, StringComparison.OrdinalIgnoreCase);
                bool supportsDelete = currentStatus.SupportedActions.Contains("DeleteTheme");
                deleteThemeButton.Visibility = savedTheme ? Visibility.Visible : Visibility.Collapsed;
                deleteThemeButton.IsEnabled = savedTheme && !activeTheme && supportsDelete && !busy &&
                    service != null && service.CanManage;
                deleteThemeButton.ToolTip = activeTheme
                    ? "当前正在使用该主题，请先应用其他主题后再删除"
                    : !supportsDelete ? "当前管理脚本不支持删除主题" : null;
            }
            if (saveThemeButton != null) saveThemeButton.IsEnabled = state.CanSaveTheme && service != null && service.CanManage;
            if (saveApplyButton != null) saveApplyButton.IsEnabled = state.CanSaveApply && service != null && service.CanManage;
        }

        private bool ConfirmRestart(string operation)
        {
            return MessageBox.Show(this, operation + "需要关闭并重新打开 Codex。是否继续？", "确认操作", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
        }

        private bool ConfirmThemeRecoveryRestart(string themeName)
        {
            string message = "将应用“" + themeName + "”并重新启动 Codex。未保存的输入可能丢失。\n\n" +
                "管理器不会终止身份无法确认的进程；若安全检查失败，将中止恢复并保留诊断状态。是否继续？";
            return MessageBox.Show(this, message, "确认应用并重启", MessageBoxButton.YesNo,
                MessageBoxImage.Warning) == MessageBoxResult.Yes;
        }

        private void SetMessage(string message, bool error)
        {
            if (messageText == null) return;
            messageText.Text = message;
            messageText.Foreground = error ? DangerBrush : MutedBrush;
        }

        private static string BuildStatusDetails(DreamSkinStatus status)
        {
            List<string> lines = new List<string>();
            if (!string.IsNullOrWhiteSpace(status.StatusMessage)) lines.Add(status.StatusMessage);
            if (!string.IsNullOrWhiteSpace(status.ManagerApiVersion)) lines.Add("管理接口：" + status.ManagerApiVersion);
            if (!string.IsNullOrWhiteSpace(status.NodeVersion)) lines.Add("Node.js：" + status.NodeVersion);
            if (!string.IsNullOrWhiteSpace(status.CodexVersion)) lines.Add("Codex：" + status.CodexVersion);
            return string.Join(Environment.NewLine, lines.ToArray());
        }

        private void UpdateCustomPreview()
        {
            if (customPreviewSurface == null || positionXSlider == null || positionYSlider == null || zoomSlider == null) return;
            if (customPreviewBitmap != null)
                ApplyFramingPreviewLayer(customPreviewSurface, customPreviewImageLayer, customPreviewBitmap,
                    positionXSlider.Value / 100.0, positionYSlider.Value / 100.0,
                    zoomSlider.Value / 100.0,
                    positionModeSegment != null && positionModeSegment.SelectedIndex == 1 ? "free" : "locked");
        }

        private void RefreshDashboardPreview()
        {
            ClearDashboardPreview();
            ThemeOption selected = themeList == null ? null : themeList.SelectedItem as ThemeOption;
            if (selected != null)
            {
                try
                {
                    BitmapSource bitmap = LoadPreviewBitmap(selected.ImagePath);
                    if (bitmap == null) return;
                    dashboardPreviewBitmap = bitmap;
                    dashboardPreviewTheme = selected;
                    dashboardPreviewMutedFill = PreviewMath.UsesCustomFraming(selected.FramingEnabled,
                        selected.PositionX, selected.PositionY, selected.Zoom, selected.PositionMode)
                        ? CreateMutedImageFill(bitmap) : null;
                    ApplyThemePreview(previewSurface, previewImageLayer, bitmap, selected, dashboardPreviewMutedFill);
                    return;
                }
                catch { return; }
            }

            try
            {
                BitmapSource bitmap = LoadPreviewBitmap(currentStatus.ActiveThemeImage);
                if (bitmap == null) return;
                ThemeOption activeTheme = new ThemeOption {
                    FocusX = currentStatus.ActiveFocusX, FocusY = currentStatus.ActiveFocusY,
                    PositionX = currentStatus.ActivePositionX, PositionY = currentStatus.ActivePositionY,
                    Zoom = currentStatus.ActiveZoom, PositionMode = currentStatus.ActivePositionMode,
                    FramingEnabled = currentStatus.ActiveFramingEnabled
                };
                dashboardPreviewBitmap = bitmap;
                dashboardPreviewTheme = activeTheme;
                dashboardPreviewMutedFill = PreviewMath.UsesCustomFraming(activeTheme.FramingEnabled,
                    activeTheme.PositionX, activeTheme.PositionY, activeTheme.Zoom, activeTheme.PositionMode)
                    ? CreateMutedImageFill(bitmap) : null;
                ApplyThemePreview(previewSurface, previewImageLayer, bitmap, activeTheme, dashboardPreviewMutedFill);
            }
            catch { }
        }

        private void ReapplyDashboardPreview()
        {
            if (dashboardPreviewBitmap != null && dashboardPreviewTheme != null)
                ApplyThemePreview(previewSurface, previewImageLayer, dashboardPreviewBitmap, dashboardPreviewTheme,
                    dashboardPreviewMutedFill);
        }

        private void ClearDashboardPreview()
        {
            dashboardPreviewBitmap = null;
            dashboardPreviewTheme = null;
            dashboardPreviewMutedFill = null;
            if (previewImageLayer != null)
            {
                previewImageLayer.Source = null;
                previewImageLayer.Visibility = Visibility.Collapsed;
            }
            if (previewSurface != null) previewSurface.Background = BrushFrom("#E3E8EE");
        }

        private static Border CreatePreviewSurface(string automationName, double minimumHeight, double maximumHeight, double aspectRatio)
        {
            ResponsivePreviewBorder border = new ResponsivePreviewBorder
            {
                PreviewMinHeight = minimumHeight,
                PreviewMaxHeight = maximumHeight,
                PreviewAspectRatio = aspectRatio,
                VerticalAlignment = VerticalAlignment.Top,
                Background = BrushFrom("#E3E8EE"),
                BorderBrush = AppBorderBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7),
                ClipToBounds = true
            };
            AutomationProperties.SetName(border, automationName);
            Grid shell = new Grid { Margin = new Thickness(18) };
            shell.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(92) });
            shell.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Border sidebar = new Border { Background = new SolidColorBrush(Color.FromArgb(215, 248, 249, 251)), CornerRadius = new CornerRadius(6, 0, 0, 6), Padding = new Thickness(12) };
            StackPanel lines = new StackPanel();
            for (int i = 0; i < 5; i++) lines.Children.Add(new Border { Height = 8, Background = BrushFrom("#CCD2DA"), CornerRadius = new CornerRadius(3), Margin = new Thickness(0, 0, 0, 10) });
            sidebar.Child = lines;
            shell.Children.Add(sidebar);
            Border main = new Border { Background = new SolidColorBrush(Color.FromArgb(90, 255, 255, 255)), BorderBrush = new SolidColorBrush(Color.FromArgb(150, 217, 222, 229)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(0, 6, 6, 0), Padding = new Thickness(24) };
            Grid mainGrid = new Grid();
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(50) });
            Border composer = new Border { Background = new SolidColorBrush(Color.FromArgb(235, 255, 255, 255)), BorderBrush = AppBorderBrush, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6) };
            Grid.SetRow(composer, 1);
            mainGrid.Children.Add(composer);
            main.Child = mainGrid;
            Grid.SetColumn(main, 1);
            shell.Children.Add(main);
            Grid previewLayers = new Grid();
            previewLayers.Children.Add(shell);
            Grid marker = new Grid
            {
                Width = 18,
                Height = 18,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                IsHitTestVisible = false,
                Visibility = Visibility.Collapsed
            };
            AutomationProperties.SetName(marker, "FocusMarker");
            marker.Children.Add(new Border { BorderBrush = Brushes.White, BorderThickness = new Thickness(2), CornerRadius = new CornerRadius(9) });
            marker.Children.Add(new Border { Width = 2, Height = 18, Background = PrimaryBrush, HorizontalAlignment = HorizontalAlignment.Center });
            marker.Children.Add(new Border { Width = 18, Height = 2, Background = PrimaryBrush, VerticalAlignment = VerticalAlignment.Center });
            Panel.SetZIndex(marker, 10);
            previewLayers.Children.Add(marker);
            border.Child = previewLayers;
            border.Tag = marker;
            return border;
        }

        private static BitmapSource SetPreviewImage(Border surface, string path, double x, double y)
        {
            BitmapSource bitmap = LoadPreviewBitmap(path);
            if (surface == null || bitmap == null) return null;
            ApplyPreviewBrush(surface, bitmap, x, y);
            return bitmap;
        }

        private static BitmapSource LoadPreviewBitmap(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return null;
            BitmapImage bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.DecodePixelWidth = 1280;
            bitmap.UriSource = new Uri(path, UriKind.Absolute);
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }

        private static Image CreatePreviewImageLayer(Border surface, string automationName)
        {
            Grid layers = surface == null ? null : surface.Child as Grid;
            if (layers == null) throw new InvalidOperationException("预览图层结构无效。");
            Image image = new Image { Stretch = Stretch.Fill, HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
            AutomationProperties.SetName(image, automationName);
            layers.Children.Insert(0, image);
            return image;
        }

        private static void ApplyPreviewBrush(Border surface, BitmapSource bitmap, double x, double y)
        {
            double viewportWidth = surface.ActualWidth > 0 ? surface.ActualWidth : 800;
            double viewportHeight = surface.ActualHeight > 0 ? surface.ActualHeight : (double.IsNaN(surface.Height) ? 330 : surface.Height);
            PreviewCrop crop = PreviewMath.CalculateCrop(bitmap.PixelWidth, bitmap.PixelHeight,
                viewportWidth, viewportHeight, x, y);
            ImageBrush brush = new ImageBrush(bitmap);
            brush.Stretch = Stretch.Fill;
            brush.ViewboxUnits = BrushMappingMode.RelativeToBoundingBox;
            brush.Viewbox = new Rect(crop.X, crop.Y, crop.Width, crop.Height);
            surface.Background = brush;
        }

        private static void ApplyFramingPreviewLayer(Border surface, Image image, BitmapSource bitmap,
            double positionX, double positionY, double zoom, string positionMode)
        {
            if (surface == null || image == null || bitmap == null) return;
            double viewportWidth = surface.ActualWidth > 0 ? surface.ActualWidth : 800;
            double viewportHeight = surface.ActualHeight > 0 ? surface.ActualHeight :
                (double.IsNaN(surface.Height) ? 330 : surface.Height);
            PreviewLayout layout = PreviewMath.CalculateFramingLayout(bitmap.PixelWidth, bitmap.PixelHeight,
                viewportWidth, viewportHeight, positionX, positionY, zoom, positionMode);
            image.Source = bitmap;
            image.Width = layout.Width;
            image.Height = layout.Height;
            image.Margin = new Thickness(layout.X, layout.Y, 0, 0);
            image.Visibility = Visibility.Visible;
        }

        private static void ApplyThemePreview(Border surface, Image image, BitmapSource bitmap, ThemeOption theme,
            Brush mutedFill = null)
        {
            if (surface == null || image == null || bitmap == null || theme == null) return;
            if (PreviewMath.UsesCustomFraming(theme.FramingEnabled,
                theme.PositionX, theme.PositionY, theme.Zoom, theme.PositionMode))
            {
                surface.Background = mutedFill ?? CreateMutedImageFill(bitmap);
                ApplyFramingPreviewLayer(surface, image, bitmap,
                    theme.PositionX, theme.PositionY, theme.Zoom, theme.PositionMode);
                return;
            }
            image.Source = null;
            image.Visibility = Visibility.Collapsed;
            ApplyPreviewBrush(surface, bitmap, theme.FocusX, theme.FocusY);
        }

        private static Brush CreateMutedImageFill(BitmapSource bitmap)
        {
            if (bitmap == null || bitmap.PixelWidth < 1 || bitmap.PixelHeight < 1) return BrushFrom("#E3E8EE");
            FormatConvertedBitmap converted = new FormatConvertedBitmap(bitmap, PixelFormats.Bgra32, null, 0);
            int stride = converted.PixelWidth * 4;
            byte[] pixels = new byte[stride * converted.PixelHeight];
            converted.CopyPixels(pixels, stride, 0);
            int stepX = Math.Max(1, converted.PixelWidth / 48);
            int stepY = Math.Max(1, converted.PixelHeight / 48);
            long red = 0, green = 0, blue = 0, count = 0;
            for (int y = 0; y < converted.PixelHeight; y += stepY)
            {
                for (int x = 0; x < converted.PixelWidth; x += stepX)
                {
                    int offset = y * stride + x * 4;
                    if (pixels[offset + 3] < 16) continue;
                    blue += pixels[offset];
                    green += pixels[offset + 1];
                    red += pixels[offset + 2];
                    count++;
                }
            }
            if (count == 0) return BrushFrom("#E3E8EE");
            const double imageWeight = 0.32;
            byte r = (byte)Math.Round(235 * (1 - imageWeight) + (red / (double)count) * imageWeight);
            byte g = (byte)Math.Round(240 * (1 - imageWeight) + (green / (double)count) * imageWeight);
            byte b = (byte)Math.Round(244 * (1 - imageWeight) + (blue / (double)count) * imageWeight);
            SolidColorBrush brush = new SolidColorBrush(Color.FromRgb(r, g, b));
            brush.Freeze();
            return brush;
        }

        private static Border PanelBorder()
        {
            return new Border { Background = SurfaceBrush, BorderBrush = AppBorderBrush, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(7), Padding = new Thickness(18) };
        }

        private static TextBlock SectionLabel(string text)
        {
            return new TextBlock { Text = text, Foreground = MutedBrush, FontWeight = FontWeights.SemiBold };
        }

        private static TextBlock FieldLabel(string text)
        {
            return new TextBlock { Text = text, Foreground = TextBrush, Margin = new Thickness(0, 12, 0, 6), FontWeight = FontWeights.SemiBold };
        }

        private static TextBox InputBox(string hint)
        {
            TextBox box = new TextBox { MinHeight = 34, Padding = new Thickness(9, 6, 9, 6), BorderBrush = AppBorderBrush, BorderThickness = new Thickness(1), ToolTip = hint };
            return box;
        }

        private static ComboBox CreateCombo(string[] items, int selected)
        {
            ComboBox box = new ComboBox { MinHeight = 34, Padding = new Thickness(8, 4, 8, 4), BorderBrush = AppBorderBrush };
            foreach (string item in items) box.Items.Add(item);
            box.SelectedIndex = selected;
            return box;
        }

        private static Slider CreateSlider(double minimum, double maximum, double value,
            double tickFrequency, string automationName)
        {
            Slider slider = new Slider { Minimum = minimum, Maximum = maximum, Value = value,
                TickFrequency = tickFrequency, IsSnapToTickEnabled = false };
            AutomationProperties.SetName(slider, automationName);
            return slider;
        }

        private static Grid SliderLabel(string text, TextBlock value)
        {
            Grid grid = new Grid { Margin = new Thickness(0, 12, 0, 4) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.Children.Add(new TextBlock { Text = text, FontWeight = FontWeights.SemiBold });
            Grid.SetColumn(value, 1);
            grid.Children.Add(value);
            return grid;
        }

        private static Button PrimaryButton(string text)
        {
            return BaseButton(text, PrimaryButtonPalette);
        }

        private static Button SecondaryButton(string text)
        {
            return BaseButton(text, SecondaryButtonPalette);
        }

        private static Button DangerButton(string text)
        {
            return BaseButton(text, DangerButtonPalette);
        }

        private static Button BaseButton(string text, ButtonPalette palette)
        {
            return new Button {
                Content = text,
                MinHeight = 40,
                Padding = new Thickness(12, 8, 12, 8),
                BorderThickness = new Thickness(1),
                FontSize = 14,
                FontWeight = FontWeights.Medium,
                HorizontalContentAlignment = HorizontalAlignment.Center,
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = palette.NormalBackground,
                Foreground = palette.NormalForeground,
                BorderBrush = palette.NormalBorder,
                Template = CreateButtonTemplate(palette),
                Cursor = System.Windows.Input.Cursors.Hand
            };
        }

        private static ControlTemplate CreateButtonTemplate(ButtonPalette palette)
        {
            FrameworkElementFactory focus = new FrameworkElementFactory(typeof(Border));
            focus.Name = "FocusChrome";
            focus.SetValue(Border.BorderThicknessProperty, new Thickness(2));
            focus.SetValue(Border.BorderBrushProperty, Brushes.Transparent);
            focus.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));

            FrameworkElementFactory chrome = new FrameworkElementFactory(typeof(Border));
            chrome.Name = "ButtonChrome";
            chrome.SetValue(Border.CornerRadiusProperty, new CornerRadius(6));
            chrome.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            chrome.SetValue(Border.BackgroundProperty, palette.NormalBackground);
            chrome.SetValue(Border.BorderBrushProperty, palette.NormalBorder);

            FrameworkElementFactory content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.Name = "ButtonContent";
            content.SetValue(ContentPresenter.ContentProperty,
                new TemplateBindingExtension(ContentControl.ContentProperty));
            content.SetValue(ContentPresenter.ContentTemplateProperty,
                new TemplateBindingExtension(ContentControl.ContentTemplateProperty));
            content.SetValue(FrameworkElement.MarginProperty,
                new TemplateBindingExtension(Control.PaddingProperty));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            content.SetValue(TextElement.ForegroundProperty, palette.NormalForeground);
            chrome.AppendChild(content);
            focus.AppendChild(chrome);

            ControlTemplate template = new ControlTemplate(typeof(Button));
            template.VisualTree = focus;
            template.Triggers.Add(CreateButtonStateTrigger(UIElement.IsMouseOverProperty, true,
                palette.HoverBackground, palette.HoverForeground, palette.HoverBorder));
            template.Triggers.Add(CreateButtonStateTrigger(ButtonBase.IsPressedProperty, true,
                palette.PressedBackground, palette.PressedForeground, palette.PressedBorder));

            Trigger keyboardFocus = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
            keyboardFocus.Setters.Add(new Setter(Border.BorderBrushProperty, ButtonFocusBrush, "FocusChrome"));
            template.Triggers.Add(keyboardFocus);

            Trigger disabled = CreateButtonStateTrigger(UIElement.IsEnabledProperty, false,
                ButtonDisabledBackground, ButtonDisabledForeground, ButtonDisabledBorder);
            disabled.Setters.Add(new Setter(FrameworkElement.CursorProperty,
                System.Windows.Input.Cursors.Arrow, "FocusChrome"));
            template.Triggers.Add(disabled);
            return template;
        }

        private static Trigger CreateButtonStateTrigger(DependencyProperty property, object value,
            Brush background, Brush foreground, Brush border)
        {
            Trigger trigger = new Trigger { Property = property, Value = value };
            trigger.Setters.Add(new Setter(Border.BackgroundProperty, background, "ButtonChrome"));
            trigger.Setters.Add(new Setter(Border.BorderBrushProperty, border, "ButtonChrome"));
            trigger.Setters.Add(new Setter(TextElement.ForegroundProperty, foreground, "ButtonContent"));
            return trigger;
        }

        private static ItemsPanelTemplate HorizontalItemsPanel()
        {
            FrameworkElementFactory factory = new FrameworkElementFactory(typeof(WrapPanel));
            factory.SetValue(WrapPanel.OrientationProperty, Orientation.Horizontal);
            return new ItemsPanelTemplate(factory);
        }

        private static ItemsPanelTemplate HorizontalStackItemsPanel()
        {
            FrameworkElementFactory factory = new FrameworkElementFactory(typeof(StackPanel));
            factory.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);
            return new ItemsPanelTemplate(factory);
        }

        private static Style SegmentedItemStyle(double minimumWidth, Thickness padding)
        {
            FrameworkElementFactory chrome = new FrameworkElementFactory(typeof(Border));
            chrome.Name = "SegmentChrome";
            chrome.SetValue(Border.CornerRadiusProperty, new CornerRadius(4));
            chrome.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            chrome.SetValue(Border.BackgroundProperty, SurfaceBrush);
            chrome.SetValue(Border.BorderBrushProperty, Brushes.Transparent);
            chrome.SetValue(Border.PaddingProperty,
                new TemplateBindingExtension(Control.PaddingProperty));

            FrameworkElementFactory content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.Name = "SegmentContent";
            content.SetValue(ContentPresenter.ContentProperty,
                new TemplateBindingExtension(ContentControl.ContentProperty));
            content.SetValue(ContentPresenter.ContentTemplateProperty,
                new TemplateBindingExtension(ContentControl.ContentTemplateProperty));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            content.SetValue(TextElement.ForegroundProperty, TextBrush);
            chrome.AppendChild(content);

            ControlTemplate template = new ControlTemplate(typeof(ListBoxItem));
            template.VisualTree = chrome;

            Trigger hover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            hover.Setters.Add(new Setter(Border.BackgroundProperty, BrushFrom("#EEF1F4"), "SegmentChrome"));
            hover.Setters.Add(new Setter(Border.BorderBrushProperty, AppBorderBrush, "SegmentChrome"));
            template.Triggers.Add(hover);

            Trigger selected = new Trigger { Property = ListBoxItem.IsSelectedProperty, Value = true };
            selected.Setters.Add(new Setter(Border.BackgroundProperty, SecondaryButtonPalette.NormalBackground, "SegmentChrome"));
            selected.Setters.Add(new Setter(Border.BorderBrushProperty, SecondaryButtonPalette.HoverBorder, "SegmentChrome"));
            selected.Setters.Add(new Setter(TextElement.ForegroundProperty, SecondaryButtonPalette.NormalForeground, "SegmentContent"));
            selected.Setters.Add(new Setter(TextElement.FontWeightProperty, FontWeights.SemiBold, "SegmentContent"));
            template.Triggers.Add(selected);

            Trigger focus = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
            focus.Setters.Add(new Setter(Border.BorderBrushProperty, ButtonFocusBrush, "SegmentChrome"));
            template.Triggers.Add(focus);

            Trigger disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
            disabled.Setters.Add(new Setter(UIElement.OpacityProperty, 0.55, "SegmentChrome"));
            template.Triggers.Add(disabled);

            Style style = new Style(typeof(ListBoxItem));
            style.Setters.Add(new Setter(Control.TemplateProperty, template));
            style.Setters.Add(new Setter(Control.PaddingProperty, padding));
            style.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, minimumWidth));
            style.Setters.Add(new Setter(FrameworkElement.MarginProperty, new Thickness(1, 0, 1, 0)));
            style.Setters.Add(new Setter(Control.HorizontalContentAlignmentProperty, HorizontalAlignment.Center));
            style.Setters.Add(new Setter(FrameworkElement.CursorProperty, System.Windows.Input.Cursors.Hand));
            return style;
        }

        private static DataTemplate ThemeTemplate()
        {
            FrameworkElementFactory border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.WidthProperty, 124.0);
            border.SetValue(Border.HeightProperty, 112.0);
            border.SetValue(Border.MarginProperty, new Thickness(4));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(6));
            border.SetValue(Border.BorderBrushProperty, AppBorderBrush);
            border.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            border.SetValue(Border.BackgroundProperty, SurfaceBrush);

            FrameworkElementFactory stack = new FrameworkElementFactory(typeof(StackPanel));
            FrameworkElementFactory image = new FrameworkElementFactory(typeof(Image));
            image.SetValue(Image.HeightProperty, 78.0);
            image.SetValue(Image.StretchProperty, Stretch.UniformToFill);
            image.SetBinding(Image.SourceProperty, new Binding("ThumbnailImage"));
            stack.AppendChild(image);

            FrameworkElementFactory metadata = new FrameworkElementFactory(typeof(DockPanel));
            metadata.SetValue(FrameworkElement.MarginProperty, new Thickness(7, 5, 7, 0));

            FrameworkElementFactory dot = new FrameworkElementFactory(typeof(Border));
            dot.SetValue(FrameworkElement.WidthProperty, 7.0);
            dot.SetValue(FrameworkElement.HeightProperty, 7.0);
            dot.SetValue(Border.CornerRadiusProperty, new CornerRadius(4));
            dot.SetValue(FrameworkElement.MarginProperty, new Thickness(0, 4, 6, 0));
            dot.SetValue(DockPanel.DockProperty, Dock.Left);
            dot.SetBinding(Border.BackgroundProperty, new Binding("CategoryColor"));
            metadata.AppendChild(dot);

            FrameworkElementFactory source = new FrameworkElementFactory(typeof(TextBlock));
            source.SetValue(TextBlock.ForegroundProperty, MutedBrush);
            source.SetValue(TextBlock.FontSizeProperty, 10.0);
            source.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
            source.SetValue(DockPanel.DockProperty, Dock.Right);
            source.SetBinding(TextBlock.TextProperty, new Binding("SourceLabel"));
            metadata.AppendChild(source);

            FrameworkElementFactory text = new FrameworkElementFactory(typeof(TextBlock));
            text.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
            text.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
            text.SetBinding(TextBlock.TextProperty, new Binding("Name"));
            metadata.AppendChild(text);
            stack.AppendChild(metadata);
            border.AppendChild(stack);

            DataTemplate template = new DataTemplate(typeof(ThemeOption));
            template.VisualTree = border;
            return template;
        }

        private static string TranslatePresetName(string name)
        {
            Dictionary<string, string> names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                { "Romantic Rose", "浪漫玫瑰" }, { "Cyber Neon", "赛博霓虹" },
                { "Sakura Dawn", "樱花黎明" }, { "Forest Mist", "森林薄雾" },
                { "Midnight Aurora", "午夜极光" }, { "Amber Dusk", "琥珀黄昏" }
            };
            string translated;
            return names.TryGetValue(name, out translated) ? translated : name;
        }

        private static string CleanThemeName(string name)
        {
            string translated = TranslatePresetName(name ?? "");
            return translated.IndexOf('\uFFFD') >= 0 ? "已保存主题" : translated;
        }

        private static string MapAppearance(int index) { return index == 1 ? "light" : index == 2 ? "dark" : "auto"; }
        private static string MapCategory(int index) { string[] values = { "all", "dream", "nature", "cyber", "minimal", "dark", "warm", "uncategorized" }; return values[Math.Max(0, Math.Min(index, values.Length - 1))]; }
        private static string MapSource(int index) { return index == 1 ? "preset" : index == 2 ? "saved" : "all"; }
        private static string MapSafeArea(int index) { string[] values = { "auto", "left", "right", "center", "none" }; return values[Math.Max(0, Math.Min(index, values.Length - 1))]; }
        private static string MapTaskMode(int index) { string[] values = { "auto", "ambient", "banner", "full", "off" }; return values[Math.Max(0, Math.Min(index, values.Length - 1))]; }

        private static SolidColorBrush BrushFrom(string value)
        {
            SolidColorBrush brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(value));
            brush.Freeze();
            return brush;
        }

        private static LinearGradientBrush GoldGradient(string top, string bottom)
        {
            LinearGradientBrush brush = new LinearGradientBrush(
                BrushFrom(top).Color, BrushFrom(bottom).Color,
                new Point(0.5, 0), new Point(0.5, 1));
            brush.Freeze();
            return brush;
        }
    }
}
