$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$script:CachedElement = $null
$script:CachedTargetId = ""

function Write-Response($id, $ok, $data, $errorMessage) {
  $response = @{
    id = $id
    ok = $ok
  }

  if ($ok) {
    $response.data = $data
  } else {
    $response.error = $errorMessage
  }

  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.Flush()
}

function Get-Pattern($element, $pattern) {
  $patternObject = $null
  if ($null -ne $element -and $element.TryGetCurrentPattern($pattern, [ref]$patternObject)) {
    return $patternObject
  }

  return $null
}

function Get-TargetId($element) {
  $runtimeId = $element.GetRuntimeId()
  if ($null -ne $runtimeId -and $runtimeId.Length -gt 0) {
    return [string]::Join(".", $runtimeId)
  }

  return "target-" + [Guid]::NewGuid().ToString("N")
}

function Get-TopLevelWindowHandle($element) {
  if ($null -eq $element) {
    return 0
  }

  $handle = 0
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $current = $element
  while ($null -ne $current) {
    try {
      $candidate = [int]$current.Current.NativeWindowHandle
      if ($candidate -ne 0) {
        $handle = $candidate
        if ($current.Current.ControlType.ProgrammaticName -eq "ControlType.Window") {
          return $candidate
        }
      }
    } catch {
      return $handle
    }

    $current = $walker.GetParent($current)
  }

  return $handle
}

function Get-ElementTarget($element) {
  if ($null -eq $element) {
    return $null
  }

  $current = $element.Current
  if (-not $current.IsEnabled -or $current.IsOffscreen -or $current.IsPassword) {
    return $null
  }

  $rect = $current.BoundingRectangle
  if ($rect.Width -lt 24 -or $rect.Height -lt 12) {
    return $null
  }

  $textPattern = Get-Pattern $element ([System.Windows.Automation.TextPattern]::Pattern)
  $valuePattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
  $controlType = $current.ControlType.ProgrammaticName
  $canRead = $null -ne $textPattern -or $null -ne $valuePattern
  $canWrite = $false
  if ($null -ne $valuePattern) {
    $canWrite = -not $valuePattern.Current.IsReadOnly
  }

  $isEditableType =
    $controlType -eq "ControlType.Edit" -or
    $controlType -eq "ControlType.Document" -or
    $controlType -eq "ControlType.ComboBox"

  if (-not $canRead -or (-not $isEditableType -and $null -eq $valuePattern)) {
    return $null
  }

  $targetId = Get-TargetId $element
  $script:CachedElement = $element
  $script:CachedTargetId = $targetId

  return @{
    targetId = $targetId
    windowHandle = Get-TopLevelWindowHandle $element
    controlType = $controlType
    canReadText = [bool]$canRead
    canWriteText = [bool]$canWrite
    bounds = @{
      x = [int][Math]::Round($rect.X)
      y = [int][Math]::Round($rect.Y)
      width = [int][Math]::Round($rect.Width)
      height = [int][Math]::Round($rect.Height)
    }
  }
}

function Get-SelectedText($element) {
  $textPattern = Get-Pattern $element ([System.Windows.Automation.TextPattern]::Pattern)
  if ($null -eq $textPattern) {
    return ""
  }

  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($range in $textPattern.GetSelection()) {
    $text = $range.GetText(8001)
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      $parts.Add($text)
    }
  }

  return [string]::Join("`n", $parts)
}

function Get-WholeText($element) {
  $textPattern = Get-Pattern $element ([System.Windows.Automation.TextPattern]::Pattern)
  if ($null -ne $textPattern) {
    return $textPattern.DocumentRange.GetText(8001)
  }

  $valuePattern = Get-Pattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -ne $valuePattern) {
    return [string]$valuePattern.Current.Value
  }

  return ""
}

function Normalize-ComparableText($text) {
  return ([string]$text) -replace "(\r|\n)+$", ""
}

function Assert-CachedTarget($targetId) {
  if ([string]::IsNullOrWhiteSpace($targetId) -or $targetId -ne $script:CachedTargetId -or $null -eq $script:CachedElement) {
    throw "Input target changed."
  }
}

function Handle-GetTarget {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  return Get-ElementTarget $focused
}

function Handle-CaptureText {
  if ($null -eq $script:CachedElement) {
    $null = Handle-GetTarget
  }

  if ($null -eq $script:CachedElement) {
    throw "No editable input is focused."
  }

  $target = Get-ElementTarget $script:CachedElement
  if ($null -eq $target) {
    throw "No editable input is focused."
  }

  $selected = Get-SelectedText $script:CachedElement
  if (-not [string]::IsNullOrWhiteSpace($selected)) {
    return @{
      target = $target
      scope = "selection"
      text = $selected
    }
  }

  return @{
    target = $target
    scope = "whole"
    text = Get-WholeText $script:CachedElement
  }
}

function Handle-VerifySelection($payload) {
  Assert-CachedTarget ([string]$payload.targetId)
  $selected = Get-SelectedText $script:CachedElement
  if ($selected -ne [string]$payload.sourceText) {
    throw "Selection changed before replace."
  }

  $script:CachedElement.SetFocus()
  return @{ verified = $true }
}

function Handle-ReplaceWholeText($payload) {
  Assert-CachedTarget ([string]$payload.targetId)
  $current = Get-WholeText $script:CachedElement
  if ((Normalize-ComparableText $current) -ne (Normalize-ComparableText $payload.sourceText)) {
    throw "Input text changed before replace."
  }

  $valuePattern = Get-Pattern $script:CachedElement ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -eq $valuePattern -or $valuePattern.Current.IsReadOnly) {
    throw "Focused input cannot be replaced directly."
  }

  $valuePattern.SetValue([string]$payload.replacementText)
  return @{ replaced = $true }
}

function Handle-FocusTarget($payload) {
  Assert-CachedTarget ([string]$payload.targetId)
  $script:CachedElement.SetFocus()
  return @{ focused = $true }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) {
    break
  }

  try {
    $message = $line | ConvertFrom-Json
    $payload = $message.payload
    $data = $null

    switch ([string]$message.type) {
      "getTarget" { $data = Handle-GetTarget }
      "captureText" { $data = Handle-CaptureText }
      "verifySelection" { $data = Handle-VerifySelection $payload }
      "replaceWholeText" { $data = Handle-ReplaceWholeText $payload }
      "focusTarget" { $data = Handle-FocusTarget $payload }
      default { throw "Unknown command." }
    }

    Write-Response ([string]$message.id) $true $data $null
  } catch {
    Write-Response ([string]$message.id) $false $null ($_.Exception.Message)
  }
}
