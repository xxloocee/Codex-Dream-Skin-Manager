using System.Windows;
using System.Windows.Markup;

namespace CodexDreamSkinManager
{
    internal static class ManagerControlStyles
    {
        private static readonly ResourceDictionary Styles = (ResourceDictionary)XamlReader.Parse(@"
<ResourceDictionary xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
                    xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'>
  <Style x:Key='Search' TargetType='{x:Type TextBox}'>
    <Setter Property='MinHeight' Value='36'/>
    <Setter Property='VerticalContentAlignment' Value='Center'/>
    <Setter Property='Template'>
      <Setter.Value>
        <ControlTemplate TargetType='{x:Type TextBox}'>
          <Border x:Name='Chrome' Background='White' BorderBrush='#D9DEE5' BorderThickness='1' CornerRadius='7'>
            <Grid Margin='11,0,10,0'>
              <Grid.ColumnDefinitions><ColumnDefinition Width='23'/><ColumnDefinition Width='*'/></Grid.ColumnDefinitions>
              <Path Data='M 10,6 A 4,4 0 1 1 2,6 A 4,4 0 1 1 10,6 M 9,9 L 14,14'
                    Stroke='#68707B' StrokeThickness='1.5' VerticalAlignment='Center' Width='16' Height='16'/>
              <ScrollViewer x:Name='PART_ContentHost' Grid.Column='1' Margin='0,7'/>
              <TextBlock x:Name='Hint' Grid.Column='1' Text='{TemplateBinding ToolTip}' Foreground='#7B838D'
                         VerticalAlignment='Center' IsHitTestVisible='False' Visibility='Collapsed'/>
            </Grid>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property='Text' Value=''><Setter TargetName='Hint' Property='Visibility' Value='Visible'/></Trigger>
            <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Chrome' Property='BorderBrush' Value='#BCA36B'/></Trigger>
            <Trigger Property='IsKeyboardFocusWithin' Value='True'><Setter TargetName='Chrome' Property='BorderBrush' Value='#B68C38'/></Trigger>
            <Trigger Property='IsEnabled' Value='False'><Setter TargetName='Chrome' Property='Opacity' Value='0.55'/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key='ComboItem' TargetType='{x:Type ComboBoxItem}'>
    <Setter Property='Padding' Value='11,8'/>
    <Setter Property='Margin' Value='3,1'/>
    <Setter Property='HorizontalContentAlignment' Value='Stretch'/>
    <Setter Property='Template'>
      <Setter.Value>
        <ControlTemplate TargetType='{x:Type ComboBoxItem}'>
          <Border x:Name='Chrome' Background='Transparent' CornerRadius='5' Padding='{TemplateBinding Padding}'>
            <ContentPresenter/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property='IsHighlighted' Value='True'><Setter TargetName='Chrome' Property='Background' Value='#F4F0E6'/></Trigger>
            <Trigger Property='IsSelected' Value='True'>
              <Setter TargetName='Chrome' Property='Background' Value='#171717'/>
              <Setter Property='Foreground' Value='#F0CE7D'/>
            </Trigger>
            <Trigger Property='IsEnabled' Value='False'><Setter Property='Opacity' Value='0.5'/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key='Combo' TargetType='{x:Type ComboBox}'>
    <Setter Property='MinHeight' Value='36'/>
    <Setter Property='Foreground' Value='#20242A'/>
    <Setter Property='ItemContainerStyle' Value='{StaticResource ComboItem}'/>
    <Setter Property='ScrollViewer.CanContentScroll' Value='True'/>
    <Setter Property='Template'>
      <Setter.Value>
        <ControlTemplate TargetType='{x:Type ComboBox}'>
          <Grid>
            <ToggleButton x:Name='Toggle' Focusable='False' ClickMode='Press'
                          IsChecked='{Binding IsDropDownOpen, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}'>
              <ToggleButton.Template>
                <ControlTemplate TargetType='{x:Type ToggleButton}'>
                  <Border x:Name='Chrome' Background='White' BorderBrush='#D9DEE5' BorderThickness='1' CornerRadius='7'>
                    <Path Data='M 0,0 L 4,4 L 8,0' Stroke='#68707B' StrokeThickness='1.5'
                          HorizontalAlignment='Right' VerticalAlignment='Center' Margin='0,0,12,0'/>
                  </Border>
                  <ControlTemplate.Triggers>
                    <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Chrome' Property='BorderBrush' Value='#BCA36B'/></Trigger>
                    <Trigger Property='IsChecked' Value='True'><Setter TargetName='Chrome' Property='BorderBrush' Value='#B68C38'/></Trigger>
                  </ControlTemplate.Triggers>
                </ControlTemplate>
              </ToggleButton.Template>
            </ToggleButton>
            <ContentPresenter Margin='12,0,32,0' VerticalAlignment='Center' IsHitTestVisible='False'
                              Content='{TemplateBinding SelectionBoxItem}' ContentTemplate='{TemplateBinding SelectionBoxItemTemplate}'/>
            <Border x:Name='FocusRing' BorderBrush='#B68C38' BorderThickness='1' CornerRadius='7' IsHitTestVisible='False' Visibility='Collapsed'/>
            <Popup x:Name='PART_Popup' Placement='Bottom' AllowsTransparency='True' Focusable='False'
                   IsOpen='{TemplateBinding IsDropDownOpen}' PopupAnimation='Fade'>
              <Border Background='White' BorderBrush='#D9DEE5' BorderThickness='1' CornerRadius='8' Padding='3'
                      Margin='0,5,0,5' MinWidth='{Binding ActualWidth, RelativeSource={RelativeSource TemplatedParent}}'>
                <ScrollViewer MaxHeight='{TemplateBinding MaxDropDownHeight}' CanContentScroll='True'
                              VerticalScrollBarVisibility='Auto' HorizontalScrollBarVisibility='Disabled'>
                  <ItemsPresenter KeyboardNavigation.DirectionalNavigation='Contained'/>
                </ScrollViewer>
              </Border>
            </Popup>
          </Grid>
          <ControlTemplate.Triggers>
            <Trigger Property='IsKeyboardFocusWithin' Value='True'><Setter TargetName='FocusRing' Property='Visibility' Value='Visible'/></Trigger>
            <Trigger Property='IsEnabled' Value='False'><Setter Property='Opacity' Value='0.5'/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key='Tab' TargetType='{x:Type TabItem}'>
    <Setter Property='Template'>
      <Setter.Value>
        <ControlTemplate TargetType='{x:Type TabItem}'>
          <Border x:Name='Chrome' Background='Transparent' CornerRadius='7' BorderThickness='1' BorderBrush='Transparent'
                  Padding='20,10' Margin='0,0,6,0'>
            <ContentPresenter x:Name='Header' ContentSource='Header' HorizontalAlignment='Center' VerticalAlignment='Center'
                              TextElement.Foreground='#68707B' TextElement.FontSize='13' TextElement.FontWeight='SemiBold' RecognizesAccessKey='True'/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Chrome' Property='Background' Value='#ECEEF1'/></Trigger>
            <Trigger Property='IsSelected' Value='True'>
              <Setter TargetName='Chrome' Property='Background' Value='#171717'/>
              <Setter TargetName='Chrome' Property='BorderBrush' Value='#9E7C39'/>
              <Setter TargetName='Header' Property='TextElement.Foreground' Value='#F0CE7D'/>
            </Trigger>
            <Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Chrome' Property='BorderBrush' Value='#D8AE57'/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key='Tabs' TargetType='{x:Type TabControl}'>
    <Setter Property='ItemContainerStyle' Value='{StaticResource Tab}'/>
    <Setter Property='Template'>
      <Setter.Value>
        <ControlTemplate TargetType='{x:Type TabControl}'>
          <Grid KeyboardNavigation.TabNavigation='Local'>
            <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='*'/></Grid.RowDefinitions>
            <Grid Margin='0,0,0,4'>
              <Grid.ColumnDefinitions><ColumnDefinition Width='*'/><ColumnDefinition Width='Auto'/></Grid.ColumnDefinitions>
              <TabPanel x:Name='HeaderPanel' IsItemsHost='True' KeyboardNavigation.TabIndex='1'/>
              <ContentPresenter Grid.Column='1' Content='{TemplateBinding Tag}' VerticalAlignment='Center' Margin='16,0,0,0'/>
            </Grid>
            <ContentPresenter x:Name='PART_SelectedContentHost' Grid.Row='1' ContentSource='SelectedContent'
                              Margin='0' KeyboardNavigation.TabIndex='2'/>
          </Grid>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key='ScrollPage' TargetType='{x:Type RepeatButton}'>
    <Setter Property='Focusable' Value='False'/>
    <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='{x:Type RepeatButton}'><Border Background='Transparent'/></ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style x:Key='VerticalScroll' TargetType='{x:Type ScrollBar}'>
    <Setter Property='Width' Value='12'/>
    <Setter Property='MinWidth' Value='12'/>
    <Setter Property='Stylus.IsFlicksEnabled' Value='False'/>
    <Setter Property='Template'>
      <Setter.Value>
        <ControlTemplate TargetType='{x:Type ScrollBar}'>
          <Border Background='#F4F6F8' CornerRadius='6'>
            <Track x:Name='PART_Track' Orientation='Vertical' IsDirectionReversed='True'>
              <Track.DecreaseRepeatButton><RepeatButton Command='ScrollBar.PageUpCommand' Style='{StaticResource ScrollPage}'/></Track.DecreaseRepeatButton>
              <Track.Thumb>
                <Thumb MinHeight='32'>
                  <Thumb.Template>
                    <ControlTemplate TargetType='{x:Type Thumb}'>
                      <Border x:Name='Grip' Background='#C4C8CE' CornerRadius='4' Margin='3,2'/>
                      <ControlTemplate.Triggers>
                        <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Grip' Property='Background' Value='#AD9560'/></Trigger>
                        <Trigger Property='IsDragging' Value='True'><Setter TargetName='Grip' Property='Background' Value='#9E7C39'/></Trigger>
                      </ControlTemplate.Triggers>
                    </ControlTemplate>
                  </Thumb.Template>
                </Thumb>
              </Track.Thumb>
              <Track.IncreaseRepeatButton><RepeatButton Command='ScrollBar.PageDownCommand' Style='{StaticResource ScrollPage}'/></Track.IncreaseRepeatButton>
            </Track>
          </Border>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
</ResourceDictionary>");

        public static Style Get(string key) { return (Style)Styles[key]; }
    }
}
