function ConvertTo-JsonObjectPreservingLexicalTypes($Value) {
  if ($Value -is [System.Collections.IDictionary]) {
    $properties = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $properties[[string]$key] = ConvertTo-JsonObjectPreservingLexicalTypes $Value[$key]
    }
    return [pscustomobject]$properties
  }

  if ($Value -is [System.Collections.IList] -and $Value -isnot [string]) {
    $items = @($Value | ForEach-Object { ConvertTo-JsonObjectPreservingLexicalTypes $_ })
    return ,$items
  }

  return $Value
}

function ConvertFrom-JsonTokenPreservingLexicalTypes($Token) {
  if ($Token -is [Newtonsoft.Json.Linq.JObject]) {
    $properties = [ordered]@{}
    foreach ($property in $Token.Properties()) {
      $properties[$property.Name] = ConvertFrom-JsonTokenPreservingLexicalTypes $property.Value
    }
    return [pscustomobject]$properties
  }

  if ($Token -is [Newtonsoft.Json.Linq.JArray]) {
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in $Token.Children()) {
      $items.Add((ConvertFrom-JsonTokenPreservingLexicalTypes $item))
    }
    return ,$items.ToArray()
  }

  if ($Token -is [Newtonsoft.Json.Linq.JValue]) {
    return $Token.Value
  }
  throw "Unsupported JSON token type."
}

function ConvertFrom-JsonCorePreservingLexicalTypes {
  param([Parameter(Mandatory = $true)][string]$Json)

  # PowerShell 7.0-7.4 ships Newtonsoft.Json but has neither DateKind nor
  # the .NET Framework-only System.Web.Extensions assembly.
  Add-Type -AssemblyName Newtonsoft.Json -ErrorAction Stop
  $inputReader = New-Object System.IO.StringReader($Json)
  $reader = New-Object Newtonsoft.Json.JsonTextReader($inputReader)
  try {
    $reader.DateParseHandling = [Newtonsoft.Json.DateParseHandling]::None
    $serializer = New-Object Newtonsoft.Json.JsonSerializer
    $serializer.DateParseHandling = [Newtonsoft.Json.DateParseHandling]::None
    $serializer.CheckAdditionalContent = $true
    $token = $serializer.Deserialize($reader)
    if ($null -eq $token) { return $null }
    if ($token -is [Newtonsoft.Json.Linq.JToken]) {
      return ConvertFrom-JsonTokenPreservingLexicalTypes $token
    }
    return $token
  } finally {
    $reader.Close()
    $inputReader.Dispose()
  }
}

function ConvertFrom-JsonPreservingLexicalTypes {
  param([Parameter(Mandatory = $true)][string]$Json)

  $command = Get-Command ConvertFrom-Json -ErrorAction Stop
  if ($command.Parameters.ContainsKey("DateKind")) {
    return ConvertFrom-Json -InputObject $Json -DateKind String
  }

  if ($PSVersionTable.PSEdition -eq "Core") {
    return ConvertFrom-JsonCorePreservingLexicalTypes -Json $Json
  }

  Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
  $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $serializer.MaxJsonLength = 67108864
  return ConvertTo-JsonObjectPreservingLexicalTypes ($serializer.DeserializeObject($Json))
}
