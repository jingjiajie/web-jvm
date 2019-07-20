var jvm = {};

(function () {
	jvm.klasses = {};
	jvm.classObjects = {};
	jvm.stringPool = {}; //字符串常量池

	function Klass(name, descriptor, superClass, interfaces, access_flags, methods, fields, bytes, constant_pool, constant_pool_types) {
		this.name = name;
		this.descriptor = descriptor;
		this.superClass = superClass;
		this.interfaces = interfaces;
		this.access_flags = access_flags;
		this.methods = methods;
		this.fields = fields;
		this.bytes = bytes;
		this.constant_pool = constant_pool;
		this.constant_pool_types = constant_pool_types;
	}

	Klass.prototype.isSubClassOf = function (klass) {
		var me = this;
		if (me === klass) return true;
		var myDescriptor = me.descriptor;
		var klassDescriptor = klass.descriptor;
		/*处理数组 */
		var dimension = 0;
		while (true) {
			if (myDescriptor[dimension] == '[') {
				if (klassDescriptor[dimension] == '[')++dimension;
				else return false;
			} else if (klassDescriptor[dimension] == '[') return false;
			else break;
		}
		if (dimension > 0) {
			me = jvm.loadClass(myDescriptor.substring(dimension));
			klass = jvm.loadClass(klassDescriptor.substring(dimension));
		}
		// Check superclasses
		if (klass.access_flags & 0x0200) {
			// interface
			while (me) {
				for (var i = 0; i < me.interfaces.length; i++) {
					if (me.interfaces[i] == klass.name) return true;
				}
				me = me.superClass && jvm.loadClass(me.superClass);
			}
		} else {
			for (var mySuperClass = null; me.superClass; me = mySuperKlass) {
				mySuperKlass = jvm.loadClass(me.superClass);
				if (mySuperKlass == klass) return true;
			}
		}
		return false;
	}

	jvm.loadClass = function (className) {
		if (className[0] == 'L') {
			className = className.substring(1, className.length - 1);
		}

		var klass = jvm.klasses[className];
		if (klass) return klass;

		function makePrimitiveKlass(descriptor, name) {
			return jvm.klasses[descriptor] = new Klass(name, descriptor, 'java/lang/Object', [], 0x1011/*ACC_PUBLIC | ACC_FINAL | ACC_SYNTHETIC*/, [], [], null, [null], [null]);
		}

		switch (className) {
			case 'V': return this.klasses['V'] = makePrimitiveKlass('V', 'void');
			case "Z": return this.klasses['Z'] = makePrimitiveKlass('Z', 'boolean');
			case "C": return this.klasses['C'] = makePrimitiveKlass('C', 'char');
			case "F": return this.klasses['F'] = makePrimitiveKlass('F', 'float');
			case "D": return this.klasses['D'] = makePrimitiveKlass('D', 'double');
			case "B": return this.klasses['B'] = makePrimitiveKlass('B', 'byte');
			case "S": return this.klasses['S'] = makePrimitiveKlass('S', 'short');
			case "I": return this.klasses['I'] = makePrimitiveKlass('I', 'int');
			case "J": return this.klasses['J'] = makePrimitiveKlass('J', 'long');
		}

		if (className[0] == "[") {
			return this.klasses[className] = new Klass(className, className, 'java/lang/Object', [], 0x1011, [], [], null, [null], [null]);
		}

		klass = jvm.loadClassFile(className);
		if (klass.superClass) {
			jvm.loadClass(klass.superClass);
		}
		if (klass.methods["<clinit>()V"]) {
			jvm.interpreter.invokeFirst(klass, klass.methods["<clinit>()V"]);
		}
		this.klasses[className] = klass;
		if (klass.onInitFinish) {
			klass.onInitFinish();
		}
		return klass;

	}

	jvm.loadClassFile = function (className) {

		if (!className) {
			debugger;
		}
		var bytes = jvm.fetchBytes("../lib/" + className + ".class");

		if (!(bytes[0] == 0xCA && bytes[1] == 0xFE && bytes[2] == 0xBA && bytes[3] == 0xBE)) {
			throw "Not a class file";
		}

		var pos = 4;

		function u2() {
			return 256 * bytes[pos++] + bytes[pos++];
		}

		function u4() {
			return 256 * 256 * 256 * bytes[pos++] + 256 * 256 * bytes[pos++] + 256 * bytes[pos++] + bytes[pos++];
		}

		function u1() {
			return bytes[pos++];
		}

		function utf8string() {
			var len = u2();
			var end = pos + len;
			var chars = new Array(len);
			while (pos < end) {
				var x = bytes[pos++];
				if (x < 0x80) {
					chars.push(String.fromCharCode(x));
				} else {
					var y = bytes[pos++];
					if ((x & 0xe0) == 0xc0) {
						chars.push(String.fromCharCode(((x & 0x1f) << 6) + (y & 0x3f)));
					} else if ((x & 0xf0) == 0xe0) {
						var z = bytes[pos++];
						chars.push(String.fromCharCode(((x & 0xf) << 12) + ((y & 0x3f) << 6) + (z & 0x3f)));
					} else {
						throw "Illegal unicode character";
					}
				}
			}
			return chars.join('');
		}

		u2(); // minor version
		u2(); // major version

		var constant_pool_count = u2();
		var constant_pool = [null];
		var constant_pool_types = [null];
		while (constant_pool.length < constant_pool_count) {
			var type = u1();
			constant_pool_types.push(type);
			switch (type) {
				case 0:
					pos--;
					break;
				case 7: //CONSTANT_Class
					var name_index = u2();
					constant_pool.push(name_index);
					break;
				case 9: //CONSTANT_Fieldref
				case 10: //CONSTANT_Methodref
				case 11: //CONSTANT_InterfaceMethodref
					var class_index = u2();
					var name_and_type_index = u2();
					constant_pool.push({ class_index: class_index, name_and_type_index: name_and_type_index });
					break;
				case 8: // CONSTANT_String
					constant_pool.push(u2());
					break;
				case 3: // CONSTANT_Integer
					var val = u4();
					constant_pool.push((val > 0x7FFFFFFF) ? - (0xFFFFFFFF - val) - 1 : val);
					break;
				case 4: // CONSTANT_Float
					var b = u4();
					switch (true) {
						case (b == 0x7f800000):
							constant_pool.push(Number.POSITIVE_INFINITY);
							break;
						case (b == 0xff800000):
							constant_pool.push(Number.NEGATIVE_INFINITY);
							break;
						case ((b >= 0x7f800001 && b <= 0x7fffffff) || (b > 0xff800001 && b <= 0xffffffff)):
							constant_pool.push(NaN);
							break;
						default:
							var s = ((b >> 31) == 0) ? 1 : -1;
							var e = ((b >> 23) & 0xff);
							var m = (e == 0) ?
								(b & 0x7fffff) << 1 :
								(b & 0x7fffff) | 0x800000;
							constant_pool.push(s * m * Math.pow(2, e - 150));
							break;
					}
					break;
				case 5: // CONSTANT_Long
					var high_bytes = u4();
					var low_bytes = u4();
					constant_pool.push(new Long(low_bytes, high_bytes));
					constant_pool.push(null);
					constant_pool_types.push(null);
					break;
				case 6: // CONSTANT_Double
					var high_bytes = u4();
					var low_bytes = u4();
					switch (true) {
						case (high_bytes == 0x7ff00000 && low_bytes == 0):
							constant_pool.push(Number.POSITIVE_INFINITY);
							break;
						case (high_bytes == 0xfff00000 && low_bytes == 0):
							constant_pool.push(Number.NEGATIVE_INFINITY);
							break;
						case (high_bytes > 0x7ff00000 && high_bytes <= 0x7fffffff):
							constant_pool.push(NaN);
							break;
						case (high_bytes > 0xfff00000 && high_bytes <= 0xffffffff):
							constant_pool.push(NaN);
							break;
						default:
							var s = ((high_bytes >> 31) == 0) ? 1 : -1;
							var e = ((high_bytes >> 20) & 0x7ff);
							var m = (e == 0) ?
								(((high_bytes & 0xfffff)) + low_bytes * Math.pow(2, -32)) << 1 :
								((high_bytes & 0xfffff | 0x100000) + (low_bytes * Math.pow(2, -32)));
							constant_pool.push(s * m * Math.pow(2, e - 1043));
							break;
					}
					constant_pool.push(null);
					constant_pool_types.push(null);
					break;
				case 12: // CONSTANT_NameAndType
					var name_index = u2();
					var descriptor_index = u2();
					constant_pool.push({ name_index: name_index, descriptor_index: descriptor_index });
					break;
				case 1: // CONSTANT_Utf8
					var string = utf8string();
					constant_pool.push(string);
					break;
				default:
					console.log("UNKNOWN constant TYPE " + type + " at index " + constant_pool.length);
			}
		}
		var access_flags = u2();
		//	var acc = [];
		//	if (access_flags & 0x0001) {
		//		acc.push("public")
		//	}
		//	if (access_flags & 0x0010) {
		//		acc.push("final")
		//	}
		//	if (access_flags & 0x0020) {
		//		acc.push("super")
		//	}
		//	if (access_flags & 0x0200) {
		//		acc.push("interface")
		//	}
		//	if (access_flags & 0x0400) {
		//		acc.push("abstract")
		//	}
		//	console.log("access_flags: " + acc.join(" "));

		var name = constant_pool[constant_pool[u2()]]; // console.log("this_class:" + constant_pool[u2()]);
		var superClass = constant_pool[constant_pool[u2()]]; // console.log("extends " + constant_pool[u2()]);
		var interfaces_count = u2();

		//	console.log("interfaces_count:" + interfaces_count);
		var interfaces = [];
		for (var i = 0; i < interfaces_count; i++) {
			interfaces.push(constant_pool[constant_pool[u2()]]); //console.log("implements " + constant_pool[u2()]);
		}

		function processAttributes() {
			var attributes_count = u2();
			for (var j = 0; j < attributes_count; j++) {
				var attribute_name_index = u2();
				//			console.log("attribute: " + );
				var attribute_length = u4();
				pos += attribute_length;
			}
		}

		var fields = {};
		var fields_count = u2();
		var offset = 0;
		//	console.log("fields_count: " + fields_count);
		for (var i = 0; i < fields_count; i++) {
			var _access_flags = u2();
			var name_index = u2();
			//		console.log("field: " + constant_pool[name_index - 1]);
			var descriptor_index = u2();
			//		console.log("descriptor: " + constant_pool[descriptor_index - 1]);
			var descriptor = constant_pool[descriptor_index];
			fields[constant_pool[name_index]] = {
				access_flags: _access_flags,
				name: constant_pool[name_index],
				descriptor: constant_pool[descriptor_index],
				offset: offset++,
				static_value: undefined
			}
			// Find constantvalue
			var attributes_count = u2();

			for (var j = 0; j < attributes_count; j++) {
				var attribute_name_index = u2();
				var attribute_length = u4();
				if ("ConstantValue" == constant_pool[attribute_name_index]) {
					fields[constant_pool[name_index]].static_value = constant_pool[u2()];
				} else {
					pos += attribute_length;
				}
			}
		}

		var methods = {};
		var methods_count = u2();
		for (var i = 0; i < methods_count; i++) {
			var startpos = pos;
			var _access_flags = u2();
			var name_index = u2();
			var descriptor_index = u2();

			var codepos = -1;

			var attributes_count = u2();

			var exception_handlers = [];
			for (var j = 0; j < attributes_count; j++) {
				var attribute_name_index = u2();
				var attribute_length = u4();
				if ("Code" == constant_pool[attribute_name_index]) {
					codepos = pos;
					var max_stack = u2();
					var max_locals = u2();
					var code_length = u4();
					pos += code_length;
					var exception_table_length = u2();
					for (var k = 0; k < exception_table_length; k++) {
						var start_pc = u2();
						var end_pc = u2();
						var handler_pc = u2();
						var catch_type = u2();
						exception_handlers.push({
							start_pc: start_pc,
							end_pc: end_pc,
							handler_pc: handler_pc,
							catch_type: constant_pool[constant_pool[catch_type]]
						});
					}
					processAttributes();
				} else {
					pos += attribute_length;
				}
			}

			var descriptor = constant_pool[descriptor_index];
			var paramTypes = [];
			var returnType = null;
			var prefix = "";
			for (var j = 0; j < descriptor.length; j++) {
				switch (descriptor[j]) {
					case "(":
						continue;
					case "[":
						prefix += "[";
						continue;
					case "L": // Object
						var scpos = descriptor.indexOf(";", j);
						paramTypes.push(prefix + descriptor.substring(j, scpos + 1));
						prefix = "";
						j = scpos;
						continue;
					case ")":
						returnType = descriptor.substring(j + 1);
						j = descriptor.length;
						break;
					default:
						paramTypes.push(prefix + descriptor[j]);
						prefix = "";
				}
			}

			methods[constant_pool[name_index] + constant_pool[descriptor_index]] = {
				pos: startpos,
				codepos: codepos,
				descriptor: descriptor,
				name: constant_pool[name_index],
				access_flags: _access_flags,
				paramTypes: paramTypes,
				returnType: returnType,
				exception_handlers: exception_handlers,
				toString: function () {
					return this.name + this.descriptor;
				}
			};
		}


		processAttributes();

		//	var attributes_count = u2();
		//	console.log("attributes count: " + attributes_count);
		//	for(var i = 0; i < attributes_count; i++) {
		//		var attribute_name_index = u2();
		//		console.log("attribute: " + constant_pool[attribute_name_index - 1]);
		//		var attribute_length = u4();
		//		pos += attribute_length;
		//	}

		return jvm.klasses[name] = new Klass(name, 'L' + name + ';', superClass, interfaces, access_flags, methods, fields, bytes, constant_pool, constant_pool_types);
	};

	function getXMLHttpRequest() {
		if (window.XMLHttpRequest) {
			return new window.XMLHttpRequest;
		}
		else {
			try {
				return new ActiveXObject("MSXML2.XMLHTTP");
			}
			catch (ex) {
				return null;
			}
		}
	}


	if (/msie/i.test(navigator.userAgent) && !/opera/i.test(navigator.userAgent)) {
		var IEBinaryToArray_ByteStr_Script =
			"<!-- IEBinaryToArray_ByteStr -->\r\n" +
			"<script type='text/vbscript'>\r\n" +
			"Function IEBinaryToArray_ByteStr(Binary)\r\n" +
			"   IEBinaryToArray_ByteStr = CStr(Binary)\r\n" +
			"End Function\r\n" +
			"Function IEBinaryToArray_ByteStr_Last(Binary)\r\n" +
			"   Dim lastIndex\r\n" +
			"   lastIndex = LenB(Binary)\r\n" +
			"   if lastIndex mod 2 Then\r\n" +
			"       IEBinaryToArray_ByteStr_Last = Chr( AscB( MidB( Binary, lastIndex, 1 ) ) )\r\n" +
			"   Else\r\n" +
			"       IEBinaryToArray_ByteStr_Last = " + '""' + "\r\n" +
			"   End If\r\n" +
			"End Function\r\n" +
			"</script>\r\n";

		// inject VBScript
		document.write(IEBinaryToArray_ByteStr_Script);
	}

	if (/msie/i.test(navigator.userAgent) && !/opera/i.test(navigator.userAgent)) {
		// this fn is invoked if IE
		jvm.fetchBytes = function (fileURL) {
			var that = this;
			var req = getXMLHttpRequest();
			req.open("GET", fileURL, false);
			req.setRequestHeader("Accept-Charset", "x-user-defined");
			req.send();
			var fileContents = convertResponseBodyToText(req.responseBody);
			var fileSize = fileContents.length - 1;
			if (fileSize < 0) throwException(_exception.FileLoadFailed);
			// my helper to convert from responseBody to a "responseText" like thing
			function convertResponseBodyToText(binary) {
				var byteMapping = {};
				for (var i = 0; i < 256; i++) {
					for (var j = 0; j < 256; j++) {
						byteMapping[String.fromCharCode(i + j * 256)] =
							String.fromCharCode(i) + String.fromCharCode(j);
					}
				}
				// call into VBScript utility fns
				var rawBytes = IEBinaryToArray_ByteStr(binary);
				var lastChr = IEBinaryToArray_ByteStr_Last(binary);
				return rawBytes.replace(/[\s\S]/g, function (match) { return byteMapping[match]; }) + lastChr;
			};
			var bytes = [];
			var len = fileContents.length;
			for (var i = 0; i < len; i++) {
				bytes.push(fileContents.charCodeAt(i) & 0xff);
			}
			return bytes;
		}
	} else {
		jvm.fetchBytes = function (url) {
			var req = new XMLHttpRequest();
			req.open('GET', url, false);

			// XHR binary charset opt by Marcus Granado 2006 [http://mgran.blogspot.com]
			req.overrideMimeType('text/plain; charset=x-user-defined');
			req.send(null);

			if (req.status != 200) {
				debugger;
				throwException("Could not load file");
			}

			var fileContents = req.responseText;

			var bytes = new Uint8Array(fileContents.length);
			var len = fileContents.length;
			for (var i = 0; i < len; i++) {
				bytes[i] = fileContents.charCodeAt(i) & 0xff;
			}
			return bytes;
		}
	}

	jvm.getClassObject = function (klassOrDescriptor) {
		var klass;
		if (typeof klassOrDescriptor === 'string') {
			klass = jvm.loadClass(klassOrDescriptor);
		} else {
			klass = klassOrDescriptor;
		}
		var key = klass.name;
		if (!jvm.classObjects[key]) {
			var classklass = jvm.loadClass("java/lang/Class");
			var result = jvm.newInstance("java/lang/Class");
			result.setField("name", jvm.newInternedString(key));
			result.setMetadata("targetKlass", klass);
			jvm.classObjects[key] = result;
		}
		return jvm.classObjects[key];
	}

	var JObjectProto = makeCommonPrototype(Object.prototype);

	var JArrayProto = makeCommonPrototype(Array.prototype);
	JArrayProto.getComponentKlass = function () {
		return this[".metadata"].componentKlass;
	}

	var JStringProto = makeCommonPrototype(Object.prototype);
	JStringProto.toString = function () {
		if (!('nativeString' in this)) {
			var charArrValue = this.value;
			var chars = new Array(charArrValue.length);
			for (var i = 0; i < charArrValue.length; ++i) {
				chars[i] = String.fromCharCode(charArrValue[i]);
			}
			this.nativeString = chars.join('');
		}
		return this.nativeString;
	}

	jvm.newArray = function (componentKlass, count) {
		var value = new Array(count);
		var arrObj = jvm.newArrayFromValue(componentKlass, value);
		if (componentKlass == jvm.loadClass('I')) {
			for (var i = 0; i < count; i++) {
				arrObj[i] = 0;
			}
		}
		if (componentKlass == jvm.loadClass('J')) {
			for (var i = 0; i < count; i++) {
				arrObj[i] = Long.fromNumber(0);
			}
		}
		return arrObj;
	}

	jvm.newArrayFromValue = function (componentKlass, value) {
		value.__proto__ = JArrayProto;
		var klass = jvm.loadClass('[' + componentKlass.descriptor);
		value[".metadata"] = {
			componentKlass: componentKlass,
			klass: klass
		};
		return value;
	}

	jvm.newString = function (str) {
		if (typeof str !== 'string') {
			debugger;
		}
		var internedStrObj = this.stringPool[str];
		if (internedStrObj !== undefined) {
			return internedStrObj;
		}
		var strKlass = jvm.loadClass('java/lang/String');
		//var strObj = new String(str);
		var strObj = {};
		strObj.__proto__ = JStringProto;
		strObj[".metadata"] = {
			klassName: 'java/lang/String',
			klass: strKlass
		}
		var value = new Uint16Array(str.length);
		for (var i = 0; i < str.length; ++i) {
			value[i] = str.charCodeAt(i);
		}
		strObj.value = value;
		//jvm.interpreter.invokeFirst(strKlass, strKlass.methods['<init>([C)V'], [strObj, value]);
		return strObj;
	}

	jvm.newInternedString = function (str) {
		if (typeof str != 'string') {
			debugger;
		}
		var strObj = jvm.newString(str); //may be interned or new one
		this.stringPool[str] = strObj;
		return strObj;
	}

	jvm.internStringObject = function (strObj) {
		if (typeof strObj == 'string') debugger; //strObj should be java String object
		var key = strObj.toString();
		var internedStrObj = this.stringPool[key];
		if (internedStrObj === undefined) {
			internedStrObj = this.stringPool[key] = strObj;
		}
		return internedStrObj;
	}

	jvm.newInstance = function (className) {
		if (!(typeof className === 'string')) debugger;
		var proto = JObjectProto;
		if (className === 'java/lang/String') proto = JStringProto;
		var klass = jvm.loadClass(className);
		var obj = {
			__proto__: proto,
			".metadata": {
				klassName: klass.name,
				klass: klass
			}
		};
		return obj;
	};

	function makeCommonPrototype(baseProto) {
		var protoObj = { __proto__: baseProto };
		protoObj.setMetadata = function (key, value) {
			this[".metadata"][key] = value;
		}

		protoObj.getMetadata = function (key) {
			return this[".metadata"][key];
		}

		protoObj.getKlass = function () {
			return this[".metadata"].klass;
		}

		protoObj.getField = function (fieldName) {
			if (!(fieldName in this)) {
				debugger; /* Field not exist */
			}
			return this[fieldName];
		}

		protoObj.setField = function (fieldName, val) {
			this[fieldName] = val;
		}

		return protoObj;
	}

}).apply(jvm);