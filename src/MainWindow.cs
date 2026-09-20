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
        private readonly List<CheckBox> customTagChoices = new List<CheckBox>();
        private ListBox themeSourceSegment;
        private ComboBox themeSortCombo;
        private FrameworkElement emptyThemeState;
        private Button addImagesButton;
        private Button importPackageButton;
        private Button exportThemeButton;
        private Button downloadMediaButton;
        private Button deleteThemeButton;
        private Border previewSurface;
        private Border customPreviewSurface;
        private Image previewImageLayer;
        private Image customPreviewImageLayer;
        private BitmapSource dashboardPreviewBitmap;
        private ThemeOption dashboardPreviewTheme;
        private Brush dashboardPreviewMutedFill;
        private BitmapSource customPreviewBitmap;
        private Button pauseButton;
        private Button resetButton;
        private Button restoreButton;
        private Button refreshButton;
        private Button checkUpdateButton;
        private Button applyThemeButton;
        private Button saveThemeButton;
        private Button saveApplyButton;
        private TabControl mainTabs;
        private Button editSavedThemeButton;
        private ComboBox savedThemeSelector;
        private TextBlock savedThemeStatus;
        private ComboBox savedAppearanceCombo;
        private ComboBox savedSafeAreaCombo;
        private ComboBox savedTaskModeCombo;
        private Slider savedBubbleOpacitySlider;
        private Slider savedFocusXSlider;
        private Slider savedFocusYSlider;
        private Slider savedPositionXSlider;
        private Slider savedPositionYSlider;
        private Slider savedZoomSlider;
        private TextBlock savedFocusXValue;
        private TextBlock savedFocusYValue;
        private TextBlock savedPositionXValue;
        private TextBlock savedPositionYValue;
        private TextBlock savedZoomValue;
        private TextBlock savedBubbleOpacityValue;
        private ListBox savedPositionModeSegment;
        private CheckBox savedFramingEnabled;
        private TextBox savedAccentBox;
        private Button saveSavedThemeButton;
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
        private Slider bubbleOpacitySlider;
        private TextBlock bubbleOpacityValue;
        private Button browseImageButton;
        private DreamSkinStatus currentStatus = new DreamSkinStatus();
        private readonly SemaphoreSlim statusRefreshLock = new SemaphoreSlim(1, 1);
        private bool operationRunning;
        private bool imageValidationRunning;
        private bool updateRunning;
        private int imageValidationGeneration;
        private int statusRefreshCount;
        private bool suppressThemeSelection;
        private bool suppressSavedThemeSelection;
        private bool hasValidCustomImage;

        public MainWindow(DreamSkinService service)
        {
            this.service = service;
            Title = "Codex Dream Skin Manager";
            Width = Math.Min(1280, SystemParameters.WorkArea.Width);
            Height = Math.Min(720, SystemParameters.WorkArea.Height);
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
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.Margin = new Thickness(22);

            StackPanel statePanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            statusDot = new Border { Width = 9, Height = 9, Background = MutedBrush, CornerRadius = new CornerRadius(5), Margin = new Thickness(0, 0, 8, 0) };
            statePanel.Children.Add(statusDot);
            statusText = new TextBlock { Text = "正在读取状态...", VerticalAlignment = VerticalAlignment.Center, FontWeight = FontWeights.SemiBold };
            AutomationProperties.SetName(statusText, "StatusText");
            statePanel.Children.Add(statusText);
            checkUpdateButton = SecondaryButton("检查更新");
            checkUpdateButton.MinHeight = 32;
            checkUpdateButton.Padding = new Thickness(10, 5, 10, 5);
            checkUpdateButton.Margin = new Thickness(16, 0, 0, 0);
            Version appVersion = typeof(MainWindow).Assembly.GetName().Version;
            checkUpdateButton.ToolTip = "当前版本 v" + appVersion.Major + "." + appVersion.Minor + "." + appVersion.Build;
            AutomationProperties.SetName(checkUpdateButton, "CheckUpdateButton");
            checkUpdateButton.Click += async delegate { await CheckForUpdateAsync(); };
            statePanel.Children.Add(checkUpdateButton);
            mainTabs = new TabControl { Margin = new Thickness(0, 0, 0, 12), Background = Brushes.Transparent, BorderBrush = AppBorderBrush, Tag = statePanel };
            mainTabs.Style = ManagerControlStyles.Get("Tabs");
            TabItem dashboardTab = new TabItem { Header = "控制台", Content = BuildDashboard() };
            TabItem customTab = new TabItem { Header = "导入图片", Content = BuildCustomSkin() };
            TabItem savedThemeTab = new TabItem { Header = "主题设置", Content = BuildSavedThemeEditor() };
            AutomationProperties.SetName(customTab, "CustomSkinTab");
            AutomationProperties.SetName(savedThemeTab, "SavedThemeEditorTab");
            mainTabs.Items.Add(dashboardTab);
            mainTabs.Items.Add(customTab);
            mainTabs.Items.Add(savedThemeTab);
            root.Children.Add(mainTabs);

            messageText = new TextBlock { Text = "选择主题可预览；执行启用或恢复前会请求确认。", Foreground = MutedBrush, TextWrapping = TextWrapping.Wrap };
            Grid footer = new Grid();
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            messageText.VerticalAlignment = VerticalAlignment.Center;
            footer.Children.Add(messageText);
            Button donateButton = SecondaryButton("打赏");
            donateButton.Margin = new Thickness(16, 0, 0, 0);
            donateButton.ToolTip = "支持持续优化";
            AutomationProperties.SetName(donateButton, "DonateButton");
            donateButton.Click += delegate { ShowDonationDialog(); };
            Grid.SetColumn(donateButton, 1);
            footer.Children.Add(donateButton);
            Grid.SetRow(footer, 1);
            root.Children.Add(footer);
            viewport.Children.Add(root);
            return viewport;
        }

        private void ShowDonationDialog()
        {
            Window dialog = new Window
            {
                Title = "打赏",
                Owner = this,
                Width = 420,
                SizeToContent = SizeToContent.Height,
                MaxHeight = SystemParameters.WorkArea.Height,
                MaxWidth = SystemParameters.WorkArea.Width,
                ResizeMode = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                ShowInTaskbar = false,
                Background = SurfaceBrush,
                Foreground = TextBrush,
                FontFamily = FontFamily
            };
            StackPanel content = new StackPanel { Margin = new Thickness(24) };
            content.Children.Add(new TextBlock
            {
                Text = "持续优化中，感谢支持，金额随意。",
                FontSize = 16,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 18)
            });
            BitmapImage paymentImage = new BitmapImage();
            using (Stream stream = typeof(MainWindow).Assembly.GetManifestResourceStream("CodexDreamSkinManager.DonationQr.png"))
            {
                paymentImage.BeginInit();
                paymentImage.CacheOption = BitmapCacheOption.OnLoad;
                paymentImage.StreamSource = stream;
                paymentImage.EndInit();
                paymentImage.Freeze();
            }
            Image qrCode = new Image { Source = paymentImage, Stretch = Stretch.Uniform };
            AutomationProperties.SetName(qrCode, "微信收款二维码");
            content.Children.Add(qrCode);
            Button closeButton = SecondaryButton("关闭");
            closeButton.IsCancel = true;
            closeButton.IsDefault = true;
            closeButton.HorizontalAlignment = HorizontalAlignment.Center;
            closeButton.MinWidth = 100;
            closeButton.Margin = new Thickness(0, 18, 0, 0);
            closeButton.Click += delegate { dialog.Close(); };
            content.Children.Add(closeButton);
            dialog.Content = new ScrollViewer
            {
                Background = SurfaceBrush,
                Content = content,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
            };
            dialog.ShowDialog();
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
            themeSearchBox.Style = ManagerControlStyles.Get("Search");
            themeSearchBox.Padding = new Thickness(0);
            themeSearchBox.MinHeight = 36;
            themeSearchBox.Width = 220;
            themeSearchBox.Margin = new Thickness(0, 0, 8, 8);
            AutomationProperties.SetName(themeSearchBox, "ThemeSearch");
            themeSearchBox.TextChanged += delegate { ApplyThemeFilters(); };
            filterBar.Children.Add(themeSearchBox);

            List<string> categoryLabels = new List<string> { "全部分类" };
            categoryLabels.AddRange(ThemeCategories.Labels);
            themeCategoryCombo = CreateCombo(categoryLabels.ToArray(), 0);
            themeCategoryCombo.MinHeight = 36;
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
            themeSortCombo.MinHeight = 36;
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
            themeList.Resources[typeof(ScrollBar)] = ManagerControlStyles.Get("VerticalScroll");
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

            applyThemeButton = PrimaryButton("应用皮肤");
            applyThemeButton.Margin = new Thickness(0, 16, 0, 0);
            AutomationProperties.SetName(applyThemeButton, "ApplySkinButton");
            applyThemeButton.Click += async delegate
            {
                if (themeList.SelectedItem is ThemeOption) await ApplySelectedThemeAsync(false);
                else await EnableAsync();
            };
            controlStack.Children.Add(applyThemeButton);

            downloadMediaButton = SecondaryButton("下载素材");
            downloadMediaButton.ToolTip = "将选中主题的原始图片或视频保存到本地，保留原始格式和画质";
            AutomationProperties.SetName(downloadMediaButton, "DownloadThemeMediaButton");
            downloadMediaButton.Click += async delegate { await DownloadSelectedMediaAsync(); };

            editSavedThemeButton = SecondaryButton("编辑参数");
            editSavedThemeButton.ToolTip = "在主程序内修改所选主题的显示参数";
            AutomationProperties.SetName(editSavedThemeButton, "EditSavedThemeButton");
            editSavedThemeButton.Click += delegate { OpenSavedThemeEditor(themeList.SelectedItem as ThemeOption); };

            pauseButton = SecondaryButton("暂停");
            AutomationProperties.SetName(pauseButton, "PauseButton");
            pauseButton.Click += async delegate { await TogglePauseAsync(); };

            resetButton = SecondaryButton("重置");
            resetButton.ToolTip = "恢复内置默认主题并清除暂停状态，不停止皮肤服务";
            AutomationProperties.SetName(resetButton, "ResetButton");
            resetButton.Click += async delegate { await ResetSkinAsync(); };

            refreshButton = SecondaryButton("刷新");
            refreshButton.Click += async delegate { await RefreshStatusAsync(); };

            restoreButton = DangerButton("恢复原貌");
            restoreButton.ToolTip = "关闭皮肤并恢复 Codex 原始外观；管理脚本异常时仍可使用";
            AutomationProperties.SetName(restoreButton, "RestoreButton");
            restoreButton.Click += async delegate { await RestoreAsync(); };
            Button[] secondaryActions = { downloadMediaButton, editSavedThemeButton,
                pauseButton, resetButton, refreshButton, restoreButton };
            Grid secondaryGrid = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            secondaryGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            secondaryGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            secondaryGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (int i = 0; i < secondaryActions.Length; i++)
            {
                if (i % 2 == 0) secondaryGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                secondaryActions[i].Margin = new Thickness(0, i < 2 ? 0 : 8, 0, 0);
                Grid.SetRow(secondaryActions[i], i / 2);
                Grid.SetColumn(secondaryActions[i], i % 2 == 0 ? 0 : 2);
                secondaryGrid.Children.Add(secondaryActions[i]);
            }
            controlStack.Children.Add(secondaryGrid);
            controls.Child = controlStack;
            Grid.SetColumn(controls, 2);
            grid.Children.Add(controls);
            dashboardScroll.Content = grid;
            return dashboardScroll;
        }

        private UIElement BuildCustomSkin()
        {
            ScrollViewer scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalContentAlignment = HorizontalAlignment.Stretch };
            scroll.Resources[typeof(ScrollBar)] = ManagerControlStyles.Get("VerticalScroll");
            Grid grid = new Grid { Margin = new Thickness(4, 14, 4, 4), MaxWidth = 1260, HorizontalAlignment = HorizontalAlignment.Stretch };
            AutomationProperties.SetName(grid, "CustomThemeContent");
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(380) });
            customPreviewSurface = CreatePreviewSurface("CustomPreviewImage", 330, 480, 16.0 / 9.0);
            customPreviewImageLayer = CreatePreviewImageLayer(customPreviewSurface, "CustomPreviewImageLayer");
            customPreviewSurface.IsHitTestVisible = false;
            customPreviewSurface.SizeChanged += delegate { UpdateCustomPreview(); };
            StackPanel previewColumn = new StackPanel();
            Border tagPanel = PanelBorder();
            tagPanel.Margin = new Thickness(0, 0, 0, 16);
            StackPanel tagFields = new StackPanel();
            tagFields.Children.Add(FieldLabel("标签（可多选）"));
            WrapPanel tagChoices = new WrapPanel();
            AutomationProperties.SetName(tagChoices, "CustomThemeTags");
            foreach (string label in ThemeCategories.Labels)
            {
                CheckBox choice = new CheckBox
                {
                    Content = label,
                    Margin = new Thickness(0, 4, 16, 8),
                    Foreground = TextBrush
                };
                AutomationProperties.SetName(choice, "标签：" + label);
                customTagChoices.Add(choice);
                tagChoices.Children.Add(choice);
            }
            tagFields.Children.Add(tagChoices);
            tagFields.Children.Add(new TextBlock
            {
                Text = "可同时选择多个分类；未选择时归入艺术。",
                Foreground = MutedBrush,
                TextWrapping = TextWrapping.Wrap
            });
            tagPanel.Child = tagFields;
            previewColumn.Children.Add(tagPanel);
            previewColumn.Children.Add(customPreviewSurface);
            grid.Children.Add(previewColumn);

            Border panel = PanelBorder();
            panel.VerticalAlignment = VerticalAlignment.Top;
            AutomationProperties.SetName(panel, "CustomThemeControls");
            StackPanel fields = new StackPanel();
            fields.Children.Add(FieldLabel("主题名称"));
            themeNameBox = InputBox("例如：我的工作台");
            fields.Children.Add(themeNameBox);
            fields.Children.Add(FieldLabel("背景图片或视频"));
            Grid fileRow = new Grid();
            fileRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            fileRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            imagePathBox = InputBox("选择 PNG、APNG、JPG、WebP、GIF 或 MP4");
            imagePathBox.IsReadOnly = true;
            fileRow.Children.Add(imagePathBox);
            browseImageButton = SecondaryButton("选择文件");
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
            bubbleOpacityValue = new TextBlock { Text = "0%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("消息气泡不透明度（用户与助手）", bubbleOpacityValue));
            bubbleOpacitySlider = CreateSlider(0, 100, 0, 1, "BubbleOpacitySlider");
            bubbleOpacitySlider.ValueChanged += FramingChanged;
            fields.Children.Add(bubbleOpacitySlider);

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
            // Let the page own scrolling, including the save actions, so the
            // parameter form has no competing scrollbar or height limit.
            fields.Children.Add(saveRow);
            panel.Child = fields;
            Grid.SetColumn(panel, 2);
            grid.Children.Add(panel);
            scroll.Content = grid;
            return scroll;
        }

        private UIElement BuildSavedThemeEditor()
        {
            ScrollViewer scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalContentAlignment = HorizontalAlignment.Stretch };
            scroll.Resources[typeof(ScrollBar)] = ManagerControlStyles.Get("VerticalScroll");
            Grid grid = new Grid { Margin = new Thickness(4, 14, 4, 4), MaxWidth = 1260,
                HorizontalAlignment = HorizontalAlignment.Stretch };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(300) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            Border selectorPanel = PanelBorder();
            selectorPanel.VerticalAlignment = VerticalAlignment.Top;
            StackPanel selectorFields = new StackPanel();
            selectorFields.Children.Add(SectionLabel("选择主题"));
            selectorFields.Children.Add(new TextBlock {
                Text = "选择内置主题或“我的”主题，调整显示和取景参数。",
                Foreground = MutedBrush, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 14)
            });
            selectorFields.Children.Add(FieldLabel("主题"));
            savedThemeSelector = CreateCombo(new string[0], -1);
            savedThemeSelector.MaxDropDownHeight = 240;
            savedThemeSelector.Resources[typeof(ScrollBar)] = ManagerControlStyles.Get("VerticalScroll");
            savedThemeSelector.SelectionChanged += SavedThemeSelectionChanged;
            AutomationProperties.SetName(savedThemeSelector, "SavedThemeSelector");
            selectorFields.Children.Add(savedThemeSelector);
            savedThemeStatus = new TextBlock { Text = "正在读取主题库...", Foreground = MutedBrush,
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 14, 0, 0) };
            selectorFields.Children.Add(savedThemeStatus);
            selectorPanel.Child = selectorFields;
            grid.Children.Add(selectorPanel);

            Border editorPanel = PanelBorder();
            editorPanel.VerticalAlignment = VerticalAlignment.Top;
            StackPanel fields = new StackPanel();
            fields.Children.Add(SectionLabel("显示与取景参数"));
            fields.Children.Add(new TextBlock {
                Text = "保存后，当前正在使用的主题会立即刷新；无需关闭或重启 Codex。",
                Foreground = MutedBrush, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 10)
            });
            fields.Children.Add(FieldLabel("外观模式"));
            savedAppearanceCombo = CreateCombo(new[] { "自动", "浅色", "深色" }, 0);
            fields.Children.Add(savedAppearanceCombo);

            savedFocusXValue = new TextBlock { Text = "50%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("焦点水平位置", savedFocusXValue));
            savedFocusXSlider = CreateSlider(0, 100, 50, 1, "SavedFocusXSlider");
            savedFocusXSlider.ValueChanged += SavedThemeFramingChanged;
            fields.Children.Add(savedFocusXSlider);
            savedFocusYValue = new TextBlock { Text = "50%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("焦点垂直位置", savedFocusYValue));
            savedFocusYSlider = CreateSlider(0, 100, 50, 1, "SavedFocusYSlider");
            savedFocusYSlider.ValueChanged += SavedThemeFramingChanged;
            fields.Children.Add(savedFocusYSlider);

            fields.Children.Add(FieldLabel("文字安全区"));
            savedSafeAreaCombo = CreateCombo(new[] { "自动", "左侧", "右侧", "居中", "关闭" }, 0);
            fields.Children.Add(savedSafeAreaCombo);
            fields.Children.Add(FieldLabel("任务页模式"));
            savedTaskModeCombo = CreateCombo(new[] { "自动", "氛围", "横幅", "完整", "关闭" }, 0);
            fields.Children.Add(savedTaskModeCombo);
            savedBubbleOpacityValue = new TextBlock { Text = "0%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("消息气泡不透明度（用户与助手）", savedBubbleOpacityValue));
            savedBubbleOpacitySlider = CreateSlider(0, 100, 0, 1, "SavedBubbleOpacitySlider");
            savedBubbleOpacitySlider.ValueChanged += SavedThemeFramingChanged;
            fields.Children.Add(savedBubbleOpacitySlider);

            fields.Children.Add(FieldLabel("主题强调色"));
            Grid colorRow = new Grid();
            colorRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            colorRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            savedAccentBox = InputBox("留空即移除，例如 #FFB6C1");
            colorRow.Children.Add(savedAccentBox);
            Button colorButton = SecondaryButton("选择颜色");
            colorButton.Margin = new Thickness(8, 0, 0, 0);
            colorButton.Click += delegate { PickColor(savedAccentBox); };
            Grid.SetColumn(colorButton, 1);
            colorRow.Children.Add(colorButton);
            fields.Children.Add(colorRow);

            savedFramingEnabled = new CheckBox { Content = "启用自定义取景", Foreground = TextBrush,
                Margin = new Thickness(0, 16, 0, 0) };
            savedFramingEnabled.Checked += delegate { UpdateSavedFramingEnabledState(); };
            savedFramingEnabled.Unchecked += delegate { UpdateSavedFramingEnabledState(); };
            fields.Children.Add(savedFramingEnabled);
            savedPositionXValue = new TextBlock { Text = "0%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("水平位置", savedPositionXValue));
            savedPositionXSlider = CreateSlider(-100, 100, 0, 10, "SavedPositionXSlider");
            savedPositionXSlider.ValueChanged += SavedThemeFramingChanged;
            fields.Children.Add(savedPositionXSlider);
            savedPositionYValue = new TextBlock { Text = "0%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("垂直位置", savedPositionYValue));
            savedPositionYSlider = CreateSlider(-100, 100, 0, 10, "SavedPositionYSlider");
            savedPositionYSlider.ValueChanged += SavedThemeFramingChanged;
            fields.Children.Add(savedPositionYSlider);
            savedZoomValue = new TextBlock { Text = "100%", Foreground = MutedBrush, HorizontalAlignment = HorizontalAlignment.Right };
            fields.Children.Add(SliderLabel("缩放", savedZoomValue));
            savedZoomSlider = CreateSlider(100, 200, 100, 10, "SavedZoomSlider");
            savedZoomSlider.ValueChanged += SavedThemeFramingChanged;
            fields.Children.Add(savedZoomSlider);
            savedPositionModeSegment = new ListBox { Height = 38, Background = BackgroundBrush,
                BorderBrush = AppBorderBrush, BorderThickness = new Thickness(1), Padding = new Thickness(2),
                SelectionMode = SelectionMode.Single, HorizontalAlignment = HorizontalAlignment.Left };
            ScrollViewer.SetHorizontalScrollBarVisibility(savedPositionModeSegment, ScrollBarVisibility.Disabled);
            ScrollViewer.SetVerticalScrollBarVisibility(savedPositionModeSegment, ScrollBarVisibility.Disabled);
            savedPositionModeSegment.ItemsPanel = HorizontalStackItemsPanel();
            savedPositionModeSegment.ItemContainerStyle = SegmentedItemStyle(76, new Thickness(12, 6, 12, 6));
            savedPositionModeSegment.Items.Add("锁定区域内");
            savedPositionModeSegment.Items.Add("不锁定区域");
            savedPositionModeSegment.SelectedIndex = 0;
            fields.Children.Add(savedPositionModeSegment);

            Grid actionRow = new Grid { Margin = new Thickness(0, 18, 0, 0) };
            actionRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            actionRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            actionRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Button reloadButton = SecondaryButton("恢复已存参数");
            reloadButton.Click += delegate { LoadSelectedSavedTheme(); };
            actionRow.Children.Add(reloadButton);
            saveSavedThemeButton = PrimaryButton("保存修改");
            saveSavedThemeButton.Click += async delegate { await SaveSavedThemeAsync(); };
            Grid.SetColumn(saveSavedThemeButton, 2);
            actionRow.Children.Add(saveSavedThemeButton);
            fields.Children.Add(actionRow);
            editorPanel.Child = fields;
            Grid.SetColumn(editorPanel, 2);
            grid.Children.Add(editorPanel);
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

        private async Task CheckForUpdateAsync()
        {
            if (updateRunning || operationRunning || statusRefreshCount > 0 || imageValidationRunning ||
                service == null || !service.CanUpdate) return;
            updateRunning = true;
            checkUpdateButton.Content = "正在检查...";
            UpdateActionState();
            SetMessage("正在检查软件更新...", false);
            try
            {
                UpdateCheckResult update = await service.CheckForUpdateAsync();
                if (!update.UpdateAvailable)
                {
                    string message = "当前版本 " + update.CurrentVersion + " 已是最新版。";
                    SetMessage(message, false);
                    MessageBox.Show(this, message, "检查更新", MessageBoxButton.OK, MessageBoxImage.Information);
                    return;
                }

                string question = "发现新版本 " + update.LatestVersion + "（当前 " + update.CurrentVersion + "）。\n\n" +
                    "是否下载安装包？下载完成后会校验 SHA-256，再启动安装程序；安装时可能关闭当前管理器。";
                if (MessageBox.Show(this, question, "发现新版本", MessageBoxButton.YesNo,
                    MessageBoxImage.Question) != MessageBoxResult.Yes)
                {
                    SetMessage("已取消更新。", false);
                    return;
                }

                checkUpdateButton.Content = "正在下载...";
                SetMessage("正在下载并校验 " + update.LatestVersion + " 安装包...", false);
                UpdateCheckResult started = await service.StartUpdateAsync(update.LatestVersion);
                SetMessage("已启动 " + started.LatestVersion + " 安装程序，请按提示完成更新。", false);
            }
            catch (Exception ex)
            {
                SetMessage("检查更新失败：" + ex.Message, true);
                MessageBox.Show(this, ex.Message, "检查更新失败", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            finally
            {
                updateRunning = false;
                checkUpdateButton.Content = "检查更新";
                UpdateActionState();
            }
        }

        private void UpdateStatusDisplay(DreamSkinStatus status)
        {
            if (status == null) status = new DreamSkinStatus();
            bool unhealthy = status.StatusKind == "mismatch" ||
                status.StatusKind == "uninspectable" || status.StatusKind == "error" ||
                status.StatusKind == "degraded";
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
            PopulateSavedThemeEditor();
        }

        private void PopulateSavedThemeEditor()
        {
            if (savedThemeSelector == null) return;
            ThemeOption selected = savedThemeSelector.SelectedItem as ThemeOption;
            string selectedId = selected == null ? currentStatus.ActiveThemeId : selected.Id;
            suppressSavedThemeSelection = true;
            try
            {
                savedThemeSelector.Items.Clear();
                foreach (ThemeOption theme in allThemes)
                    if (IsEditableTheme(theme)) savedThemeSelector.Items.Add(theme);
                for (int i = 0; i < savedThemeSelector.Items.Count; i++)
                {
                    ThemeOption item = savedThemeSelector.Items[i] as ThemeOption;
                    if (item != null && string.Equals(item.Id, selectedId, StringComparison.OrdinalIgnoreCase))
                    {
                        savedThemeSelector.SelectedIndex = i;
                        break;
                    }
                }
                if (savedThemeSelector.SelectedIndex < 0 && savedThemeSelector.Items.Count > 0)
                    savedThemeSelector.SelectedIndex = 0;
            }
            finally { suppressSavedThemeSelection = false; }
            LoadSelectedSavedTheme();
            UpdateActionState();
        }

        private void SavedThemeSelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (suppressSavedThemeSelection) return;
            LoadSelectedSavedTheme();
            UpdateActionState();
        }

        private void OpenSavedThemeEditor(ThemeOption theme)
        {
            if (!IsEditableTheme(theme))
            {
                SetMessage("请选择内置主题或“我的”主题后再编辑参数。", true);
                return;
            }
            if (savedThemeSelector != null)
            {
                for (int i = 0; i < savedThemeSelector.Items.Count; i++)
                {
                    ThemeOption item = savedThemeSelector.Items[i] as ThemeOption;
                    if (item != null && string.Equals(item.Id, theme.Id, StringComparison.OrdinalIgnoreCase))
                    {
                        savedThemeSelector.SelectedIndex = i;
                        break;
                    }
                }
            }
            if (mainTabs != null) mainTabs.SelectedIndex = 2;
        }

        private void LoadSelectedSavedTheme()
        {
            ThemeOption theme = savedThemeSelector == null ? null : savedThemeSelector.SelectedItem as ThemeOption;
            bool available = IsEditableTheme(theme);
            if (savedThemeStatus != null)
            {
                savedThemeStatus.Text = available
                    ? (string.Equals(theme.Id, currentStatus.ActiveThemeId, StringComparison.OrdinalIgnoreCase)
                        ? "当前正在使用此主题；保存后会立即刷新。" : "可修改此主题的显示与取景参数。")
                    : "没有可编辑的主题。";
            }
            if (!available)
            {
                SetSavedEditorControlsEnabled(false);
                return;
            }
            SetSavedEditorControlsEnabled(true);
            savedAppearanceCombo.SelectedIndex = AppearanceIndex(theme.Appearance);
            savedFocusXSlider.Value = ClampPercent(theme.FocusX * 100, 0, 100);
            savedFocusYSlider.Value = ClampPercent(theme.FocusY * 100, 0, 100);
            savedSafeAreaCombo.SelectedIndex = SafeAreaIndex(theme.SafeArea);
            savedTaskModeCombo.SelectedIndex = TaskModeIndex(theme.TaskMode);
            savedBubbleOpacitySlider.Value = ClampPercent(theme.BubbleOpacity * 100, 0, 100);
            savedAccentBox.Text = theme.Accent ?? "";
            savedFramingEnabled.IsChecked = theme.FramingEnabled;
            savedPositionXSlider.Value = ClampPercent(theme.PositionX * 100, -100, 100);
            savedPositionYSlider.Value = ClampPercent(theme.PositionY * 100, -100, 100);
            savedZoomSlider.Value = ClampPercent(theme.Zoom * 100, 100, 200);
            savedPositionModeSegment.SelectedIndex = string.Equals(theme.PositionMode, "free", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
            SavedThemeFramingChanged(null, null);
            UpdateSavedFramingEnabledState();
        }

        private void SavedThemeFramingChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (savedFocusXValue == null) return;
            savedFocusXValue.Text = Math.Round(savedFocusXSlider.Value) + "%";
            savedFocusYValue.Text = Math.Round(savedFocusYSlider.Value) + "%";
            savedPositionXValue.Text = FormatSignedPercent(savedPositionXSlider.Value);
            savedPositionYValue.Text = FormatSignedPercent(savedPositionYSlider.Value);
            savedZoomValue.Text = Math.Round(savedZoomSlider.Value) + "%";
            savedBubbleOpacityValue.Text = Math.Round(savedBubbleOpacitySlider.Value) + "%";
        }

        private void UpdateSavedFramingEnabledState()
        {
            bool enabled = savedFramingEnabled != null && savedFramingEnabled.IsChecked == true &&
                savedThemeSelector != null && IsEditableTheme(savedThemeSelector.SelectedItem as ThemeOption);
            if (savedPositionXSlider != null) savedPositionXSlider.IsEnabled = enabled;
            if (savedPositionYSlider != null) savedPositionYSlider.IsEnabled = enabled;
            if (savedZoomSlider != null) savedZoomSlider.IsEnabled = enabled;
            if (savedPositionModeSegment != null) savedPositionModeSegment.IsEnabled = enabled;
        }

        private void SetSavedEditorControlsEnabled(bool enabled)
        {
            if (savedAppearanceCombo != null) savedAppearanceCombo.IsEnabled = enabled;
            if (savedFocusXSlider != null) savedFocusXSlider.IsEnabled = enabled;
            if (savedFocusYSlider != null) savedFocusYSlider.IsEnabled = enabled;
            if (savedSafeAreaCombo != null) savedSafeAreaCombo.IsEnabled = enabled;
            if (savedTaskModeCombo != null) savedTaskModeCombo.IsEnabled = enabled;
            if (savedBubbleOpacitySlider != null) savedBubbleOpacitySlider.IsEnabled = enabled;
            if (savedAccentBox != null) savedAccentBox.IsEnabled = enabled;
            if (savedFramingEnabled != null) savedFramingEnabled.IsEnabled = enabled;
            if (savedPositionXSlider != null) savedPositionXSlider.IsEnabled = enabled;
            if (savedPositionYSlider != null) savedPositionYSlider.IsEnabled = enabled;
            if (savedZoomSlider != null) savedZoomSlider.IsEnabled = enabled;
            if (savedPositionModeSegment != null) savedPositionModeSegment.IsEnabled = enabled;
            if (saveSavedThemeButton != null) saveSavedThemeButton.IsEnabled = enabled;
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
            await RunOperationAsync(async delegate
            {
                // The manager may have stayed open while Codex exited or restarted.
                currentStatus = await service.GetStatusAsync();
                ActionAvailability availability = ActionAvailability.FromStatus(currentStatus, false, true, hasValidCustomImage);
                if (availability.RequiresRecovery)
                {
                    if (!ConfirmThemeRecoveryRestart(theme.Name))
                        throw new OperationCanceledException("已取消操作，未切换主题或重启 Codex。");
                    await service.ApplyThemeAndRecoverAsync(theme);
                }
                else
                {
                    bool restartAuthorized = await ConfirmStartupIfRequiredAsync("应用主题", restart);
                    // Confirm before mutating the theme, then start with the NEW
                    // active theme so startup appearance follows that selection.
                    await service.ApplyThemeAsync(theme);
                    await service.StartAsync(restartAuthorized);
                }
                SetExpectedRuntimeState(true, false);
            }, "主题已应用。");
        }

        private async Task DeleteSelectedThemeAsync()
        {
            ThemeOption theme = themeList == null ? null : themeList.SelectedItem as ThemeOption;
            if (!IsDeletableTheme(theme)) { SetMessage("请选择内置主题或“我的”已保存主题后再删除。", true); return; }
            if (string.Equals(theme.Id, currentStatus.ActiveThemeId, StringComparison.OrdinalIgnoreCase))
            {
                SetMessage("当前正在使用该主题，请先应用其他主题后再删除。", true);
                return;
            }
            string message = theme.IsPreset
                ? "将从内置主题库移除“" + theme.Name + "”，其背景文件将移入回收站。默认恢复主题不能删除。是否继续？"
                : "将删除“" + theme.Name + "”及其本地图片。此操作无法撤销。是否继续？";
            if (MessageBox.Show(this, message, "确认删除主题", MessageBoxButton.YesNo,
                MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            ThemeDeletionResult result = null;
            await RunOperationAsync(async delegate { result = await service.DeleteThemeAsync(theme); },
                theme.IsPreset ? "内置主题已移入回收站。" : "主题已删除。");
            if (result != null && result.CleanupPending)
                SetMessage("主题已从主题库移除，但背景文件暂未能移入回收站。", true);
        }

        internal static bool IsSavedTheme(ThemeOption theme)
        {
            return theme != null && !theme.IsPreset &&
                string.Equals(theme.Source, "saved", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(theme.ThemeDirectory);
        }

        internal static bool IsDeletableTheme(ThemeOption theme)
        {
            return IsSavedTheme(theme) || (theme != null && theme.IsPreset &&
                string.Equals(theme.Source, "preset", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(theme.Id));
        }

        internal static bool IsEditableTheme(ThemeOption theme)
        {
            return IsSavedTheme(theme) || (theme != null && theme.IsPreset &&
                string.Equals(theme.Source, "preset", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(theme.Id));
        }

        private async Task EnableAsync()
        {
            await RunOperationAsync(async delegate
            {
                currentStatus = await service.GetStatusAsync();
                if (currentStatus.IsRunning && currentStatus.IsPaused)
                    await service.SetPausedAsync(false);
                else
                    await StartSkinWithConfirmationAsync("启用皮肤");
                SetExpectedRuntimeState(true, false);
            }, "皮肤已启用。");
        }

        private async Task StartSkinWithConfirmationAsync(string operation)
        {
            bool restartAuthorized = await ConfirmStartupIfRequiredAsync(operation, false);
            await service.StartAsync(restartAuthorized);
        }

        private async Task<bool> ConfirmStartupIfRequiredAsync(string operation, bool forceRestart)
        {
            bool requiresRestart = forceRestart;
            try
            {
                await service.CheckStartupAsync();
            }
            catch (Exception ex)
            {
                if (ex.Message.IndexOf("DREAM_SKIN_RESTART_REQUIRED:", StringComparison.Ordinal) < 0) throw;
                requiresRestart = true;
            }
            if (requiresRestart && !ConfirmRestart(operation))
                throw new OperationCanceledException("已取消操作，未切换主题或重启 Codex。");
            return requiresRestart;
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
            foreach (CheckBox choice in customTagChoices)
                if (choice.IsChecked == true) options.Tags.Add((string)choice.Content);
            if (options.Tags.Count == 0) options.Tags.Add("艺术");
            options.Appearance = MapAppearance(appearanceCombo == null ? 0 : appearanceCombo.SelectedIndex);
            options.SetFramingPercent(positionXSlider.Value, positionYSlider.Value, zoomSlider.Value);
            options.PositionMode = positionModeSegment != null && positionModeSegment.SelectedIndex == 1 ? "free" : "locked";
            options.SafeArea = MapSafeArea(safeAreaCombo.SelectedIndex);
            options.TaskMode = MapTaskMode(taskModeCombo.SelectedIndex);
            options.BubbleOpacity = bubbleOpacitySlider == null ? 0 : bubbleOpacitySlider.Value / 100.0;
            options.Accent = accentBox.Text.Trim();
            return options;
        }

        private async Task SaveSavedThemeAsync()
        {
            ThemeOption theme = savedThemeSelector == null ? null : savedThemeSelector.SelectedItem as ThemeOption;
            if (!IsEditableTheme(theme)) { SetMessage("请选择内置主题或“我的”主题后再保存。", true); return; }
            SavedThemeEditOptions options = ReadSavedThemeOptions();
            try { options.Validate(); }
            catch (Exception ex) { SetMessage(ex.Message, true); return; }
            bool activeTheme = string.Equals(theme.Id, currentStatus.ActiveThemeId, StringComparison.OrdinalIgnoreCase);
            await RunOperationAsync(async delegate { await service.UpdateThemeAsync(theme, options); },
                activeTheme ? "主题参数已保存，当前界面已刷新。" : "主题参数已保存。");
        }

        private SavedThemeEditOptions ReadSavedThemeOptions()
        {
            SavedThemeEditOptions options = new SavedThemeEditOptions();
            options.Appearance = MapAppearance(savedAppearanceCombo.SelectedIndex);
            options.FocusX = savedFocusXSlider.Value / 100.0;
            options.FocusY = savedFocusYSlider.Value / 100.0;
            options.PositionX = savedPositionXSlider.Value / 100.0;
            options.PositionY = savedPositionYSlider.Value / 100.0;
            options.Zoom = savedZoomSlider.Value / 100.0;
            options.PositionMode = savedPositionModeSegment.SelectedIndex == 1 ? "free" : "locked";
            options.FramingEnabled = savedFramingEnabled.IsChecked == true;
            options.SafeArea = MapSafeArea(savedSafeAreaCombo.SelectedIndex);
            options.TaskMode = MapTaskMode(savedTaskModeCombo.SelectedIndex);
            options.BubbleOpacity = savedBubbleOpacitySlider.Value / 100.0;
            options.Accent = savedAccentBox.Text.Trim();
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
            bool cancelled = false;
            try
            {
                await action();
            }
            catch (OperationCanceledException ex)
            {
                finalMessage = ex.Message;
                cancelled = true;
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
                if (!finalError && !cancelled)
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
            if (!refreshed && !finalError && !cancelled)
            {
                finalMessage = success + " 状态刷新失败，请点击刷新状态重试。";
                finalError = true;
            }
            SetMessage(finalMessage, finalError);
        }

        private async Task BrowseImageAsync()
        {
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Title = "选择背景图片或视频";
            dialog.Filter = "图片和视频文件|*.png;*.apng;*.jpg;*.jpeg;*.webp;*.gif;*.mp4";
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
                SetMessage("正在验证背景文件...", false);
                try
                {
                    if (service == null) throw new InvalidOperationException("管理组件不可用，无法验证图片。");
                    ImageValidationResult validation = await service.ValidateImageAsync(dialog.FileName);
                    if (validationGeneration != imageValidationGeneration) return;
                    imagePathBox.Text = validation.Path;
                    if (validation.CanPreview)
                    {
                        customPreviewBitmap = LoadPreviewBitmap(validation.Path);
                        if (customPreviewBitmap != null)
                        {
                            customPreviewSurface.Background = CreateMutedImageFill(customPreviewBitmap);
                            UpdateCustomPreview();
                        }
                        else
                        {
                            customPreviewImageLayer.Source = null;
                            customPreviewSurface.Background = BrushFrom("#E3E8EE");
                        }
                    }
                    else
                    {
                        customPreviewBitmap = null;
                        customPreviewImageLayer.Source = null;
                        customPreviewSurface.Background = BrushFrom("#E3E8EE");
                    }
                    hasValidCustomImage = true;
                    string details = validation.Width + " x " + validation.Height + " · " + validation.Format.ToUpperInvariant();
                    if (string.Equals(validation.Format, "mp4", StringComparison.OrdinalIgnoreCase)) details += " · 视频";
                    else if (validation.Animated) details += " · 动图 " + validation.FrameCount + " 帧";
                    SetMessage(string.IsNullOrWhiteSpace(validation.PreviewMessage) ? "背景文件验证通过：" + details : validation.PreviewMessage + " " + details, false);
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
                Title = "添加背景图片或视频",
                Filter = "图片和视频文件|*.png;*.apng;*.jpg;*.jpeg;*.webp;*.gif;*.mp4",
                Multiselect = true
            };
            if (dialog.ShowDialog(this) != true) return;
            if (dialog.FileNames.Length > 50) { SetMessage("一次最多添加 50 个背景文件。", true); return; }
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
                TaskMode = data.TaskMode, BubbleOpacity = data.BubbleOpacity,
                Accent = data.Accent, Category = data.Category,
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

        private async Task DownloadSelectedMediaAsync()
        {
            if (operationRunning || statusRefreshCount > 0 || imageValidationRunning || updateRunning) return;
            ThemeOption theme = themeList == null ? null : themeList.SelectedItem as ThemeOption;
            if (theme == null) { SetMessage("请先选择需要下载的主题。", true); return; }
            if (!File.Exists(theme.ImagePath)) {
                SetMessage("该主题的原始图片或视频不存在，请刷新主题列表后重试。", true);
                return;
            }
            try
            {
                string source = Path.GetFullPath(theme.ImagePath);
                string extension = Path.GetExtension(source);
                SaveFileDialog dialog = new SaveFileDialog {
                    Title = "下载原图 / 视频",
                    Filter = "原始素材 (*" + extension + ")|*" + extension,
                    FileName = SafeFileName(theme.Name) + extension,
                    DefaultExt = extension,
                    AddExtension = true,
                    OverwritePrompt = true,
                    CheckPathExists = true
                };
                if (dialog.ShowDialog(this) != true) return;
                string destination = Path.GetFullPath(dialog.FileName);
                if (string.Equals(source, destination, StringComparison.OrdinalIgnoreCase)) {
                    SetMessage("所选位置就是原始素材，请选择其他文件名或文件夹。", true);
                    return;
                }
                if (!string.Equals(Path.GetExtension(destination), extension, StringComparison.OrdinalIgnoreCase)) {
                    SetMessage("下载保留原始格式，请使用 " + extension + " 扩展名。", true);
                    return;
                }
                operationRunning = true;
                UpdateActionState();
                SetMessage("正在保存原始素材...", false);
                try
                {
                    await Task.Run(delegate
                    {
                        string temporary = Path.Combine(Path.GetDirectoryName(destination),
                            ".dream-skin-download-" + Guid.NewGuid().ToString("N") + ".tmp");
                        try
                        {
                            File.Copy(source, temporary, false);
                            if (File.Exists(destination)) File.Replace(temporary, destination, null);
                            else File.Move(temporary, destination);
                        }
                        finally
                        {
                            if (File.Exists(temporary)) try { File.Delete(temporary); } catch { }
                        }
                    });
                    SetMessage("原始素材已保存：" + destination, false);
                }
                finally
                {
                    operationRunning = false;
                    UpdateActionState();
                }
            }
            catch (Exception ex) { SetMessage("下载失败：" + ex.Message, true); }
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
                    TaskMode = theme.TaskMode, BubbleOpacity = theme.BubbleOpacity, Accent = theme.Accent
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
            PickColor(accentBox);
        }

        private void PickColor(TextBox target)
        {
            if (target == null) return;
            using (System.Windows.Forms.ColorDialog dialog = new System.Windows.Forms.ColorDialog())
            {
                dialog.FullOpen = true;
                if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                    target.Text = "#" + dialog.Color.R.ToString("X2") + dialog.Color.G.ToString("X2") + dialog.Color.B.ToString("X2");
            }
        }

        private void FramingChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (positionXValue == null || positionYValue == null || zoomValue == null || bubbleOpacityValue == null) return;
            positionXValue.Text = FormatSignedPercent(positionXSlider.Value);
            positionYValue.Text = FormatSignedPercent(positionYSlider.Value);
            zoomValue.Text = Math.Round(zoomSlider.Value) + "%";
            bubbleOpacityValue.Text = Math.Round(bubbleOpacitySlider.Value) + "%";
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
            bool busy = operationRunning || statusRefreshCount > 0 || imageValidationRunning || updateRunning;
            ActionAvailability state = ActionAvailability.FromStatus(currentStatus, busy, selected, hasValidCustomImage);
            if (pauseButton != null) { pauseButton.IsEnabled = state.CanPause && service != null && service.CanManage; pauseButton.Content = state.PauseLabel; }
            if (resetButton != null) resetButton.IsEnabled = state.CanReset && service != null && service.CanManage;
            if (restoreButton != null) restoreButton.IsEnabled = state.CanRestore && service != null && service.CanRestore;
            if (refreshButton != null) refreshButton.IsEnabled = !busy && service != null && service.CanManage;
            if (checkUpdateButton != null)
                checkUpdateButton.IsEnabled = !busy && service != null && service.CanUpdate;
            if (applyThemeButton != null)
            {
                bool canRunApply = service != null && (state.RequiresRecovery ? service.CanRecover : service.CanManage);
                applyThemeButton.IsEnabled = selected
                    ? state.CanApplyTheme && canRunApply
                    : state.CanEnable && service != null && service.CanManage;
                applyThemeButton.Content = "应用皮肤";
                applyThemeButton.ToolTip = !selected && state.RequiresRecovery
                    ? "请先选择一个主题以恢复皮肤，或使用恢复原貌"
                    : selected ? "应用选中主题并按需启用皮肤；需要重启 Codex 时会先征求确认"
                    : "启用当前主题；需要重启 Codex 时会先征求确认";
            }
            if (addImagesButton != null) addImagesButton.IsEnabled = !busy && service != null && service.CanManage;
            if (browseImageButton != null) browseImageButton.IsEnabled = !busy && service != null && service.CanManage;
            if (importPackageButton != null) importPackageButton.IsEnabled = !busy && service != null && service.CanManage;
            if (exportThemeButton != null) exportThemeButton.IsEnabled = selected && !busy;
            if (downloadMediaButton != null) downloadMediaButton.IsEnabled = selected && !busy;
            if (editSavedThemeButton != null)
            {
                bool savedTheme = IsEditableTheme(selectedTheme);
                bool supportsUpdate = currentStatus.SupportedActions.Contains("UpdateTheme");
                editSavedThemeButton.Visibility = Visibility.Visible;
                editSavedThemeButton.IsEnabled = savedTheme && supportsUpdate && !busy && service != null && service.CanManage;
                editSavedThemeButton.ToolTip = !supportsUpdate ? "当前管理脚本不支持编辑主题参数" : "在主程序内修改所选主题参数";
            }
            if (deleteThemeButton != null)
            {
                bool deletableTheme = IsDeletableTheme(selectedTheme);
                bool activeTheme = deletableTheme && !string.IsNullOrWhiteSpace(currentStatus.ActiveThemeId) &&
                    string.Equals(selectedTheme.Id, currentStatus.ActiveThemeId, StringComparison.OrdinalIgnoreCase);
                bool supportsDelete = selectedTheme != null && currentStatus.SupportedActions.Contains(
                    selectedTheme.IsPreset ? "DeletePreset" : "DeleteTheme");
                deleteThemeButton.Content = selectedTheme != null && selectedTheme.IsPreset ? "删除内置主题" : "删除主题";
                deleteThemeButton.Visibility = deletableTheme ? Visibility.Visible : Visibility.Collapsed;
                deleteThemeButton.IsEnabled = deletableTheme && !activeTheme && supportsDelete && !busy &&
                    service != null && service.CanManage;
                deleteThemeButton.ToolTip = activeTheme
                    ? "当前正在使用该主题，请先应用其他主题后再删除"
                    : !supportsDelete ? "当前管理脚本不支持删除该主题" : null;
            }
            if (saveThemeButton != null) saveThemeButton.IsEnabled = state.CanSaveTheme && service != null && service.CanManage;
            if (saveApplyButton != null) saveApplyButton.IsEnabled = state.CanSaveApply && service != null && service.CanManage;
            if (saveSavedThemeButton != null)
            {
                ThemeOption savedTheme = savedThemeSelector == null ? null : savedThemeSelector.SelectedItem as ThemeOption;
                bool supportsUpdate = currentStatus.SupportedActions.Contains("UpdateTheme");
                saveSavedThemeButton.IsEnabled = IsEditableTheme(savedTheme) && supportsUpdate && !busy && service != null && service.CanManage;
            }
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
            return PreviewImageLoader.Load(path, 1280);
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
            ComboBox box = new ComboBox { MinHeight = 34, Padding = new Thickness(0), BorderBrush = AppBorderBrush };
            box.Style = ManagerControlStyles.Get("Combo");
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
            border.SetBinding(FrameworkElement.ToolTipProperty, new Binding("CategoryLabel"));

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
        private static int AppearanceIndex(string value) { return string.Equals(value, "light", StringComparison.OrdinalIgnoreCase) ? 1 : string.Equals(value, "dark", StringComparison.OrdinalIgnoreCase) ? 2 : 0; }
        private static string MapCategory(int index) { return index <= 0 || index > ThemeCategories.Ids.Length ? "all" : ThemeCategories.Ids[index - 1]; }
        private static string MapSource(int index) { return index == 1 ? "preset" : index == 2 ? "saved" : "all"; }
        private static string MapSafeArea(int index) { string[] values = { "auto", "left", "right", "center", "none" }; return values[Math.Max(0, Math.Min(index, values.Length - 1))]; }
        private static string MapTaskMode(int index) { string[] values = { "auto", "ambient", "banner", "full", "off" }; return values[Math.Max(0, Math.Min(index, values.Length - 1))]; }
        private static int SafeAreaIndex(string value)
        {
            string[] values = { "auto", "left", "right", "center", "none" };
            int index = Array.IndexOf(values, (value ?? "auto").ToLowerInvariant());
            return index < 0 ? 0 : index;
        }
        private static int TaskModeIndex(string value)
        {
            string[] values = { "auto", "ambient", "banner", "full", "off" };
            int index = Array.IndexOf(values, (value ?? "auto").ToLowerInvariant());
            return index < 0 ? 0 : index;
        }
        private static double ClampPercent(double value, double minimum, double maximum)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return minimum;
            return Math.Max(minimum, Math.Min(maximum, value));
        }

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
